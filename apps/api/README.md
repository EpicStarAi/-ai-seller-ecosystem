# API local development

Python 3.12+ required.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

Configure `DATABASE_URL` and OIDC settings in the environment. Protected endpoints reject requests unless a valid OIDC access token is supplied. No development bypass token is implemented.
