FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/panda-browsers
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 panda && mkdir /app/staticfiles && chown panda:panda /app/staticfiles
COPY --chown=panda:panda manage.py ./
COPY --chown=panda:panda panda_store ./panda_store
COPY --chown=panda:panda addons ./addons
COPY --chown=panda:panda LICENSE ./
USER panda
EXPOSE 8000
CMD ["uvicorn", "panda_store.asgi:application", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
