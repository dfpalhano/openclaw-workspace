#!/bin/bash
# Simple model router for capability-evolver optimization
# Auto-selects best model based on task type

TASK="$1"

# Default model
MODEL="deepseek/deepseek-chat"

# Task-based routing
case "$TASK" in
    *code*|*programming*|*fix*|*bug*)
        MODEL="openai/codex"
        REASON="Coding tasks"
        ;;
    *reason*|*analy*|*think*|*complex*)
        MODEL="deepseek/deepseek-reasoner"
        REASON="Reasoning tasks"
        ;;
    *heartbeat*|*check*|*simple*)
        MODEL="ollama/minimax-m2.5"
        REASON="Simple periodic tasks"
        ;;
    *finance*|*payment*|*money*)
        MODEL="moonshot/kimi-k2.5"
        REASON="Financial tasks"
        ;;
    *creative*|*write*|*story*)
        MODEL="anthropic/claude-sonnet-4-6"
        REASON="Creative tasks"
        ;;
    *)
        MODEL="deepseek/deepseek-chat"
        REASON="General purpose"
        ;;
esac

echo "Task: $TASK"
echo "Selected model: $MODEL"
echo "Reason: $REASON"

# Output in format for session_status
echo ""
echo "To use this model:"
echo "session_status(model=\"$MODEL\")"