import logging
import json
import os
import traceback
import uuid

from django.http import JsonResponse


logger = logging.getLogger(__name__)


class ApiJsonExceptionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/api/'):
            request.api_request_id = self._request_id(request)

        response = self.get_response(request)

        if request.path.startswith('/api/'):
            if response.status_code >= 500 and not self._safe_api_error(response, request.api_request_id):
                self._log_failure(request, 'UnhandledServerError', response.status_code)
                response = self._error_response(request, response.status_code)
            response['X-Request-ID'] = request.api_request_id
        return response

    def process_exception(self, request, exception):
        if not request.path.startswith('/api/'):
            return None
        self._log_failure(request, type(exception).__name__, 500, exception)
        return self._error_response(request)

    @staticmethod
    def _request_id(request):
        supplied = request.headers.get('X-Request-ID', '')
        try:
            return str(uuid.UUID(supplied))
        except (AttributeError, TypeError, ValueError):
            return str(uuid.uuid4())

    @staticmethod
    def _error_response(request, status_code=500):
        return JsonResponse({
            'detail': 'An unexpected server error occurred. Please try again.',
            'code': 'internal_error',
            'request_id': request.api_request_id,
        }, status=status_code)

    @staticmethod
    def _safe_api_error(response, request_id):
        if 'application/json' not in response.get('Content-Type', '') or response.streaming:
            return False
        try:
            payload = json.loads(response.content)
        except (TypeError, ValueError):
            return False
        return (
            isinstance(payload, dict)
            and payload.get('code') in {'internal_error', 'storage_unavailable'}
            and payload.get('request_id') == request_id
        )

    @staticmethod
    def _log_failure(request, exception_type, status_code, exception=None):
        source = 'unavailable'
        if exception and exception.__traceback__:
            frame = traceback.extract_tb(exception.__traceback__)[-1]
            source = f'{os.path.basename(frame.filename)}:{frame.lineno}:{frame.name}'
        logger.error(
            'API request failed request_id=%s method=%s path=%s status=%s exception_type=%s source=%s',
            getattr(request, 'api_request_id', 'unknown'),
            request.method,
            request.path,
            status_code,
            exception_type,
            source,
        )
