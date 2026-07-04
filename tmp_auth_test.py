import urllib.request, json

url = 'http://127.0.0.1:8000/api/auth/login/'
creds = {'username': 'admin', 'password': 'admin'}
data = json.dumps(creds).encode('utf-8')
req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
try:
    resp = urllib.request.urlopen(req)
    body = resp.read().decode('utf-8')
    print('login-status', resp.status)
    print('login-body', body)
    js = json.loads(body)
    tok = js.get('access')
    print('access', tok)
    if tok:
        req2 = urllib.request.Request('http://127.0.0.1:8000/api/users/', headers={'Authorization': f'Bearer {tok}'})
        resp2 = urllib.request.urlopen(req2)
        print('users-status', resp2.status)
        print('users-body', resp2.read().decode('utf-8')[:500])
except Exception as e:
    print('error', type(e).__name__, e)
