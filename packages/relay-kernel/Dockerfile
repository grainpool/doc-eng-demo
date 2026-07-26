FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # matplotlib must never touch a display or write a font cache outside /tmp
    MPLBACKEND=Agg \
    MPLCONFIGDIR=/tmp/matplotlib \
    HOME=/tmp

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Build identifier baked at image-build time: a digest over the exact inputs
# (requirements + source). The true OCI image digest is not readable from
# inside the container, so this is the provenance value /versions reports.
RUN sha256sum requirements.txt app/*.py | sha256sum | cut -d' ' -f1 > /app/build-id \
    && chmod 444 /app/build-id

# Non-root. Everything outside /tmp is unwritable for this user.
RUN useradd --system --no-create-home kernel
USER kernel

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
