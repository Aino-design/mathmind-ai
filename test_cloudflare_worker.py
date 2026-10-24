import unittest
import json


class TestCloudflareWorkerAI(unittest.TestCase):

    def test_json_response_formatting(self):
        def json_response(obj, status=200, headers=None):
            headers = headers or {}
            headers["Content-Type"] = "application/json; charset=utf-8"
            return json.dumps(obj), status, headers

        body, status, headers = json_response({"model": "gemini-2.0-flash", "reply": "4"}, 200)
        parsed = json.loads(body)

        self.assertEqual(status, 200)
        self.assertEqual(parsed["reply"], "4")
        self.assertIn("application/json", headers["Content-Type"])

    def test_thinking_tag_extraction(self):
        reply = "<think>Calculated 2 + 2 = 4</think>The answer is 4."
        self.assertIn("<think>", reply)

        think_start = reply.find("<think>") + 7
        think_end = reply.find("</think>")

        thinking_process = reply[think_start:think_end].strip()
        final_answer = reply[think_end + 8:].strip()

        self.assertEqual(thinking_process, "Calculated 2 + 2 = 4")
        self.assertEqual(final_answer, "The answer is 4.")


if __name__ == "__main__":
    unittest.main()
