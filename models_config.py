"""
Configuration for AI Models and Routing.

Provides best-in-class model selections for:
1. Fast response / low Time-To-First-Token (TTFT) for simple queries (e.g., 2+2) -> Gemini 2.0 Flash
2. Deep reasoning with visible thinking process stream -> DeepSeek R1 / Gemini 2.0 Flash Thinking
3. Large context window support for reading user notebook / AI notebook contents -> Gemini 2.0 Flash (1M-2M context window)
"""

from typing import Dict, Any

DEFAULT_MODEL_PROFILES: Dict[str, Dict[str, Any]] = {
    "fast_general": {
        "provider": "google",
        "model_id": "gemini-2.0-flash",
        "description": "Ultra-fast response time (<200ms TTFT) for simple queries and general conversation.",
        "max_context_tokens": 1000000,
        "supports_streaming": True,
        "supports_thinking_stream": False,
    },
    "reasoning": {
        "provider": "deepseek",
        "model_id": "deepseek-r1",
        "description": "State-of-the-art open reasoning model outputting streamable <think> reasoning blocks before final answer.",
        "max_context_tokens": 128000,
        "supports_streaming": True,
        "supports_thinking_stream": True,
        "think_tag_open": "<think>",
        "think_tag_close": "</think>",
    },
    "reasoning_fast": {
        "provider": "google",
        "model_id": "gemini-2.0-flash-thinking-exp",
        "description": "Fast multimodal reasoning model with real-time thought stream.",
        "max_context_tokens": 1000000,
        "supports_streaming": True,
        "supports_thinking_stream": True,
    },
}

ROUTING_CONFIG = {
    "auto_switch_simple_queries": True,
    "simple_query_max_length": 50,
    "default_profile": "fast_general",
    "reasoning_profile": "reasoning",
    "notebook_enabled": True,
}
