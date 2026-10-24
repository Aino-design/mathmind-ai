import unittest
from ai_service import ThinkingStreamParser, build_prompt_with_notebook, AIService


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

        # Simple short query should select ultra-fast Gemini Flash profile
        fast_profile = service.select_model_profile("2+2")
        self.assertEqual(fast_profile["model_id"], "gemini-2.0-flash")

        # Forced reasoning should select DeepSeek R1 reasoning profile
        reasoning_profile = service.select_model_profile("2+2", force_reasoning=True)
        self.assertEqual(reasoning_profile["model_id"], "deepseek-r1")


if __name__ == "__main__":
    unittest.main()
