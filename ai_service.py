"""
AI Service with streaming thinking parser, API key validation, JSON response handling, and Notebook context integration.
"""

import os
import json
from typing import Generator, Dict, Any, Optional, Tuple, List
from models_config import DEFAULT_MODEL_PROFILES, ROUTING_CONFIG


class ThinkingStreamParser:
    """
    Parses incoming chunk streams from reasoning AI models (e.g., DeepSeek R1).
    Separates thinking/reasoning process (<think>...</think>) from final response.
    """

    def __init__(self, think_open_tag: str = "<think>", think_close_tag: str = "</think>"):
        self.think_open_tag = think_open_tag
        self.think_close_tag = think_close_tag
        self.in_thinking_mode = False
        self.buffer = ""

    def process_chunk(self, chunk: str) -> Generator[Tuple[str, str], None, None]:
        """
        Yields tuples of (type, text) where type is either 'thinking' or 'response'.
        """
        self.buffer += chunk

        while self.buffer:
            if not self.in_thinking_mode:
                if self.think_open_tag in self.buffer:
                    open_idx = self.buffer.find(self.think_open_tag)
                    if open_idx > 0:
                        yield ("response", self.buffer[:open_idx])
                    self.in_thinking_mode = True
                    self.buffer = self.buffer[open_idx + len(self.think_open_tag):]
                else:
                    safe_len = len(self.buffer) - len(self.think_open_tag) + 1
                    if safe_len > 0:
                        yield ("response", self.buffer[:safe_len])
                        self.buffer = self.buffer[safe_len:]
                    else:
                        break
            else:
                if self.think_close_tag in self.buffer:
                    close_idx = self.buffer.find(self.think_close_tag)
                    if close_idx >= 0:
                        yield ("thinking", self.buffer[:close_idx])
                        self.in_thinking_mode = False
                        self.buffer = self.buffer[close_idx + len(self.think_close_tag):]
                else:
                    safe_len = len(self.buffer) - len(self.think_close_tag) + 1
                    if safe_len > 0:
                        yield ("thinking", self.buffer[:safe_len])
                        self.buffer = self.buffer[safe_len:]
                    else:
                        break

    def flush(self) -> Generator[Tuple[str, str], None, None]:
        """Flushes remaining buffer."""
        if self.buffer:
            chunk_type = "thinking" if self.in_thinking_mode else "response"
            yield (chunk_type, self.buffer)
            self.buffer = ""


def build_prompt_with_notebook(user_query: str, notebook_content: Optional[str] = None) -> str:
    """
    Injects application notebook contents into the prompt context.
    """
    if not notebook_content or not notebook_content.strip():
        return user_query

    return (
        "=== ИИ ТЕТРАДЬ (КОНТЕКСТ ПРИЛОЖЕНИЯ) ===\n"
        f"{notebook_content.strip()}\n"
        "=======================================\n\n"
        f"Запрос пользователя:\n{user_query}"
    )


def validate_api_keys(api_keys: Optional[Dict[str, str]] = None) -> Dict[str, bool]:
    """
    Validates presence of API keys in environment or configuration.
    """
    keys = api_keys or {}
    google_key = keys.get("GOOGLE_API_KEY") or os.getenv("GOOGLE_API_KEY")
    deepseek_key = keys.get("DEEPSEEK_API_KEY") or os.getenv("DEEPSEEK_API_KEY")

    return {
        "google": bool(google_key and google_key.strip()),
        "deepseek": bool(deepseek_key and deepseek_key.strip()),
    }


def format_json_response(data: Dict[str, Any], status_code: int = 200) -> Tuple[str, int, Dict[str, str]]:
    """
    Formats response data as valid JSON string with headers, preventing unexpected empty/non-JSON responses.
    """
    body = json.dumps(data, ensure_ascii=False)
    headers = {"Content-Type": "application/json; charset=utf-8"}
    return body, status_code, headers


class AIService:
    """
    Core AI Service handling model routing, notebook context inclusion, API key checks, and stream parsing.
    """

    def __init__(self, profiles: Optional[Dict[str, Dict[str, Any]]] = None, routing: Optional[Dict[str, Any]] = None):
        self.profiles = profiles or DEFAULT_MODEL_PROFILES
        self.routing = routing or ROUTING_CONFIG

    def select_model_profile(self, user_query: str, force_reasoning: bool = False) -> Dict[str, Any]:
        """
        Selects the best model profile. Simple queries get routed to ultra-fast Gemini Flash.
        Complex queries or forced reasoning get routed to DeepSeek-R1 / Gemini Thinking.
        """
        if force_reasoning:
            return self.profiles[self.routing["reasoning_profile"]]

        if self.routing.get("auto_switch_simple_queries") and len(user_query.strip()) <= self.routing.get("simple_query_max_length", 50):
            return self.profiles["fast_general"]

        return self.profiles[self.routing["default_profile"]]

    def generate_response(
        self,
        user_query: str,
        notebook_content: Optional[str] = None,
        force_reasoning: bool = False,
        api_keys: Optional[Dict[str, str]] = None,
        mock_stream_chunks: Optional[List[str]] = None,
    ) -> Generator[Tuple[str, str], None, None]:
        """
        Generates response stream yielded as (type, text) chunks.
        Type can be 'thinking', 'response', or 'error'.
        """
        profile = self.select_model_profile(user_query, force_reasoning)
        provider = profile.get("provider", "google")
        validations = validate_api_keys(api_keys)

        if not validations.get(provider, False):
            err_msg = json.dumps({
                "error": f"Missing or invalid API key for provider '{provider}'. Please set {provider.upper()}_API_KEY."
            }, ensure_ascii=False)
            yield ("error", err_msg)
            return

        prompt = build_prompt_with_notebook(user_query, notebook_content)

        parser = ThinkingStreamParser(
            think_open_tag=profile.get("think_tag_open", "<think>"),
            think_close_tag=profile.get("think_tag_close", "</think>"),
        )

        chunks = mock_stream_chunks or [f"Response using model {profile['model_id']} for prompt: {prompt}"]

        for chunk in chunks:
            for chunk_type, text in parser.process_chunk(chunk):
                yield chunk_type, text

        for chunk_type, text in parser.flush():
            yield chunk_type, text
