"""
Configuration for AI Models and Routing.

Provides best-in-class model selections for:
1. Fast response for simple queries (e.g., 2+2) -> Gemini 3.8 Flash
2. Deep reasoning with visible thinking process stream -> DeepSeek R1
3. Notebook context -> Gemini 3.8 Flash
"""

from typing import Dict, Any

DEFAULT_MODEL_PROFILES: Dict[str, Dict[str, Any]] = {
    "fast_general": {
        "provider": "google",
        "model_id": "gemini-3.8-flash",
        "description": "Fast multimodal responses for simple queries and general conversation.",
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
        "model_id": "gemini-3.8-flash",
        "description": "Multimodal responses with low-latency reasoning.",
        "max_context_tokens": 1000000,
        "supports_streaming": True,
        "supports_thinking_stream": False,
    },
}

ROUTING_CONFIG = {
    "auto_switch_simple_queries": True,
    "simple_query_max_length": 50,
    "default_profile": "fast_general",
    "reasoning_profile": "reasoning",
    "notebook_enabled": True,
}
