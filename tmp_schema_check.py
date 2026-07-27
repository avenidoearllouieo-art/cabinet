import sqlite3, os
path = os.path.join('backend','db.sqlite3')
print('db', os.path.exists(path), path)
conn = sqlite3.connect(path)
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
print(cur.fetchall())
for t in ['api_activityannouncement','api_activitydiscussion','api_activity','api_user']:
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (t,))
    print(t, cur.fetchone() is not None)
conn.close()
