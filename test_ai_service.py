import json
import unittest
from ai_service import (
    ThinkingStreamParser,
    build_prompt_with_notebook,
    validate_api_keys,
    format_json_response,
    AIService,
)


class TestAIService(unittest.TestCase):

    def test_thinking_stream_parser(self):
        parser = ThinkingStreamParser()
        raw_stream = ["<think>Calculating ", "2 + 2...", "</think>The answer is 4."]
        output = []

        for chunk in raw_stream:
            for chunk_type, text in parser.process_chunk(chunk):
                output.append((chunk_type, text))

        for chunk_type, text in parser.flush():
            output.append((chunk_type, text))

        thinking_text = "".join(text for t, text in output if t == "thinking")
        response_text = "".join(text for t, text in output if t == "response")

        self.assertEqual(thinking_text, "Calculating 2 + 2...")
        self.assertEqual(response_text, "The answer is 4.")

    def test_build_prompt_with_notebook(self):
        user_query = "Что у меня записано?"
        notebook_content = "Заметка 1: Купить молоко\nЗаметка 2: Проект ИИ"

        prompt = build_prompt_with_notebook(user_query, notebook_content)

        self.assertIn("=== ИИ ТЕТРАДЬ (КОНТЕКСТ ПРИЛОЖЕНИЯ) ===", prompt)
        self.assertIn("Заметка 1: Купить молоко", prompt)
        self.assertIn("Запрос пользователя:\nЧто у меня записано?", prompt)

    def test_model_profile_selection(self):
        service = AIService()

        fast_profile = service.select_model_profile("2+2")
        self.assertEqual(fast_profile["model_id"], "gemini-2.0-flash")

        reasoning_profile = service.select_model_profile("2+2", force_reasoning=True)
        self.assertEqual(reasoning_profile["model_id"], "deepseek-r1")

    def test_validate_api_keys(self):
        result = validate_api_keys({"GOOGLE_API_KEY": "test_key", "DEEPSEEK_API_KEY": ""})
        self.assertTrue(result["google"])
        self.assertFalse(result["deepseek"])

    def test_format_json_response(self):
        body, status, headers = format_json_response({"answer": "4"}, 200)
        parsed = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(parsed["answer"], "4")
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")

    def test_missing_api_key_error_stream(self):
        service = AIService()
        chunks = list(service.generate_response("2+2", api_keys={"GOOGLE_API_KEY": ""}))
        self.assertEqual(len(chunks), 1)
        err_type, err_json = chunks[0]
        self.assertEqual(err_type, "error")
        parsed = json.loads(err_json)
        self.assertIn("error", parsed)


if __name__ == "__main__":
    unittest.main()
