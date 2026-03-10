from mem0 import Memory
cfg = {
    "vector_store": {
        "provider": "qdrant",
        "config": {
            "collection_name": "atlas-memory",
            "path": "/home/diegopalhano/.openclaw/workspace/data/mem0-qdrant"
        }
    },
    "llm": {"provider": "openai", "config": {"model": "gpt-4o-mini"}},
    "embedder": {"provider": "openai", "config": {"model": "text-embedding-3-small"}},
    "history_db_path": "/home/diegopalhano/.openclaw/workspace/data/mem0-history.db"
}
try:
    m = Memory.from_config(cfg)
    print('OK', type(m).__name__)
except Exception as e:
    print(type(e).__name__, str(e))
