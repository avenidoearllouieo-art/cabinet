import json
import uuid

from django.http import HttpResponse, JsonResponse
from django.test import RequestFactory, SimpleTestCase

from .middleware import ApiJsonExceptionMiddleware


class ApiJsonExceptionMiddlewareTests(SimpleTestCase):
    def test_api_json_500_hides_exception_detail_and_keeps_request_id(self):
        request_id = str(uuid.uuid4())
        request = RequestFactory().patch('/api/submissions/7/', HTTP_X_REQUEST_ID=request_id)
        middleware = ApiJsonExceptionMiddleware(
            lambda _request: JsonResponse({'detail': 'private object key and secret context'}, status=500),
        )

        response = middleware(request)

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(response['X-Request-ID'], request_id)
        payload = json.loads(response.content)
        self.assertEqual(payload['request_id'], request_id)
        self.assertEqual(payload['code'], 'internal_error')
        self.assertNotIn('private object key', response.content.decode())
        self.assertNotIn('secret context', response.content.decode())

    def test_api_html_500_is_converted_to_json(self):
        request = RequestFactory().post('/api/student/submissions/upload')
        middleware = ApiJsonExceptionMiddleware(
            lambda _request: HttpResponse('<!doctype html><title>Server Error</title>', status=500),
        )

        response = middleware(request)

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(json.loads(response.content)['code'], 'internal_error')
        self.assertNotIn('<!doctype html>', response.content.decode())

    def test_non_api_html_errors_are_left_unchanged(self):
        request = RequestFactory().get('/admin/')
        middleware = ApiJsonExceptionMiddleware(
            lambda _request: HttpResponse('<!doctype html>admin error</html>', status=500),
        )

        response = middleware(request)

        self.assertEqual(response.status_code, 500)
        self.assertIn('text/html', response['Content-Type'])
        self.assertIn('<!doctype html>', response.content.decode())
