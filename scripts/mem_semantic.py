#!/usr/bin/env python3
import datetime as dt
import hashlib
import json
import math
import os
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, List, Sequence

WORKSPACE = Path('/home/diegopalhano/.openclaw/workspace')
DATA_DIR = WORKSPACE / 'data'
DB_PATH = DATA_DIR / 'atlas-memory.db'
OPENCLAW_JSON = Path('/home/diegopalhano/.openclaw/openclaw.json')
EMBED_MODEL = 'text-embedding-3-small'
CHUNK_WORDS = 220
CHUNK_OVERLAP_WORDS = 40
DEFAULT_LIMIT = 10
WATCH_POLL_SECONDS = 5

SCHEMA = '''
CREATE TABLE IF NOT EXISTS memory_embeddings (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  line_start INTEGER,
  line_end INTEGER,
  chunk_text TEXT NOT NULL,
  embedding BLOB NOT NULL,
  indexed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_file_path ON memory_embeddings(file_path);
'''


@dataclass
class Chunk:
    id: str
    file_path: str
    line_start: int
    line_end: int
    chunk_text: str


def utc_now() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def resolve_api_key() -> str:
    env_key = os.getenv('OPENAI_API_KEY', '').strip()
    if env_key:
        return env_key
    if OPENCLAW_JSON.exists():
        data = json.loads(OPENCLAW_JSON.read_text())
        provider = (((data.get('models') or {}).get('providers') or {}).get('openai') or {})
        for key_name in ('apiKey', 'api_key'):
            value = str(provider.get(key_name, '') or '').strip()
            if value:
                return value
    raise RuntimeError('OPENAI_API_KEY not found in environment or openclaw.json')


def get_openai_client():
    from openai import OpenAI  # type: ignore
    return OpenAI(api_key=resolve_api_key())


def connect_db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def markdown_files() -> list[Path]:
    files: list[Path] = []
    for path in WORKSPACE.rglob('*.md'):
        if any(part.startswith('.git') for part in path.parts):
            continue
        try:
            if path.is_file():
                files.append(path)
        except FileNotFoundError:
            continue
    return sorted(files)


def line_offsets(lines: Sequence[str]) -> list[int]:
    offsets = [0]
    total = 0
    for line in lines:
        total += len(line)
        offsets.append(total)
    return offsets


def char_to_line(offsets: Sequence[int], index: int) -> int:
    lo, hi = 0, len(offsets) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if offsets[mid] <= index:
            lo = mid
        else:
            hi = mid - 1
    return max(1, lo + 1)


def chunk_markdown_file(path: Path, words_per_chunk: int = CHUNK_WORDS, overlap_words: int = CHUNK_OVERLAP_WORDS) -> list[Chunk]:
    text = path.read_text(encoding='utf-8', errors='ignore')
    if not text.strip():
        return []

    lines = text.splitlines(keepends=True)
    offsets = line_offsets(lines)

    import re
    tokens = list(re.finditer(r'\S+', text))
    if not tokens:
        return []

    chunks: list[Chunk] = []
    step = max(1, words_per_chunk - overlap_words)
    rel_file = str(path.relative_to(WORKSPACE))

    for start_idx in range(0, len(tokens), step):
        end_idx = min(len(tokens), start_idx + words_per_chunk)
        start_char = tokens[start_idx].start()
        end_char = tokens[end_idx - 1].end()
        chunk_text = text[start_char:end_char].strip()
        if not chunk_text:
            continue
        line_start = char_to_line(offsets, start_char)
        line_end = char_to_line(offsets, max(start_char, end_char - 1))
        chunk_id = hashlib.sha256(f'{rel_file}:{line_start}:{line_end}:{chunk_text}'.encode('utf-8')).hexdigest()
        chunks.append(Chunk(id=chunk_id, file_path=rel_file, line_start=line_start, line_end=line_end, chunk_text=chunk_text))
        if end_idx >= len(tokens):
            break
    return chunks


def embed_texts(texts: Sequence[str], batch_size: int = 64) -> list[list[float]]:
    client = get_openai_client()
    vectors: list[list[float]] = []
    for start in range(0, len(texts), batch_size):
        batch = list(texts[start:start + batch_size])
        response = client.embeddings.create(model=EMBED_MODEL, input=batch)
        ordered = sorted(response.data, key=lambda item: item.index)
        vectors.extend([list(item.embedding) for item in ordered])
    return vectors


def index_file(path: Path, conn: sqlite3.Connection | None = None) -> int:
    own_conn = conn is None
    conn = conn or connect_db()
    rel_file = str(path.relative_to(WORKSPACE))
    chunks = chunk_markdown_file(path)
    conn.execute('DELETE FROM memory_embeddings WHERE file_path = ?', (rel_file,))
    if not chunks:
        if own_conn:
            conn.commit()
            conn.close()
        return 0

    embeddings = embed_texts([chunk.chunk_text for chunk in chunks])
    now = utc_now()
    conn.executemany(
        'INSERT OR REPLACE INTO memory_embeddings (id, file_path, line_start, line_end, chunk_text, embedding, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
            (
                chunk.id,
                chunk.file_path,
                chunk.line_start,
                chunk.line_end,
                chunk.chunk_text,
                json.dumps(embedding),
                now,
            )
            for chunk, embedding in zip(chunks, embeddings)
        ],
    )
    if own_conn:
        conn.commit()
        conn.close()
    return len(chunks)


def index_all_files() -> tuple[int, int]:
    conn = connect_db()
    total_files = 0
    total_chunks = 0
    try:
        for path in markdown_files():
            total_files += 1
            total_chunks += index_file(path, conn=conn)
            conn.commit()
        conn.commit()
    finally:
        conn.close()
    return total_files, total_chunks


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if not norm_a or not norm_b:
        return 0.0
    return dot / (norm_a * norm_b)


def search_chunks(query: str, limit: int = DEFAULT_LIMIT) -> list[dict]:
    query = query.strip()
    if not query:
        return []
    conn = connect_db()
    try:
        rows = conn.execute(
            'SELECT id, file_path, line_start, line_end, chunk_text, embedding, indexed_at FROM memory_embeddings'
        ).fetchall()
    finally:
        conn.close()
    if not rows:
        raise RuntimeError('No memory embeddings found. Run python3 scripts/mem-index.py first.')

    query_embedding = embed_texts([query])[0]
    query_terms = {term.lower() for term in query.split() if term.strip()}
    scored: list[dict] = []
    for row in rows:
        embedding = json.loads(row['embedding'])
        score = cosine_similarity(query_embedding, embedding)
        file_path = row['file_path']
        snippet_lower = row['chunk_text'].lower()
        lexical_hits = sum(1 for term in query_terms if term in snippet_lower)
        lexical_bonus = min(0.2, lexical_hits * 0.03)
        if file_path == 'MEMORY.md':
            lexical_bonus += 0.08
        elif file_path.endswith('/active-tasks.md') or file_path in {'SOUL.md', 'PROTOCOLS.md', 'USER.md'}:
            lexical_bonus += 0.03
        total_score = score + lexical_bonus
        scored.append(
            {
                'id': row['id'],
                'file_path': file_path,
                'line_start': row['line_start'],
                'line_end': row['line_end'],
                'chunk_text': row['chunk_text'],
                'indexed_at': row['indexed_at'],
                'score': total_score,
                'semantic_score': score,
                'lexical_bonus': lexical_bonus,
            }
        )
    scored.sort(key=lambda item: item['score'], reverse=True)
    return scored[:limit]


def file_state() -> dict[str, float]:
    state: dict[str, float] = {}
    for path in markdown_files():
        try:
            state[str(path)] = path.stat().st_mtime
        except FileNotFoundError:
            continue
    return state
