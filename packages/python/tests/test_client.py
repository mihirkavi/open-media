import io
import json
import unittest
from urllib.error import HTTPError

from open_media import OpenMedia, OpenMediaError


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def opener(responses, seen):
    def open_(request, timeout):
        seen.append(request)
        status, body, headers = responses.pop(0)
        if status >= 400:
            raise HTTPError(request.full_url, status, "error", headers, io.BytesIO(json.dumps(body).encode()))
        return FakeResponse(json.dumps(body).encode())
    return open_


class ClientTest(unittest.TestCase):
    def test_public_feed_needs_no_token(self):
        seen = []
        om = OpenMedia(base_url="https://api.test/", opener=opener([(200, {"data": []}, {})], seen))
        om.feed(sources=["farcaster", "lens"], mode="raw")
        self.assertEqual(seen[0].full_url, "https://api.test/v1/feed?sources=farcaster%2Clens&mode=raw")
        self.assertIsNone(seen[0].get_header("Authorization"))

    def test_writes_keep_one_idempotency_key_across_a_retry(self):
        seen = []
        om = OpenMedia(base_url="https://api.test", token="tok", opener=opener([(429, {}, {"Retry-After": "0"}), (201, {"id": "p1"}, {})], seen))
        self.assertEqual(om.publish("hello"), {"id": "p1"})
        self.assertEqual(seen[0].get_header("Authorization"), "Bearer tok")
        self.assertEqual(seen[0].get_header("Idempotency-key"), seen[1].get_header("Idempotency-key"))

    def test_errors_keep_the_server_code(self):
        om = OpenMedia(base_url="https://api.test", opener=opener([(401, {"error": {"code": "unauthorized", "message": "Send your token."}}, {})], []))
        with self.assertRaises(OpenMediaError) as caught:
            om.me()
        self.assertEqual((caught.exception.status, caught.exception.code), (401, "unauthorized"))


if __name__ == "__main__":
    unittest.main()
