FROM python:3.9-slim

# Instalar poppler (necesario para pdf2image)
RUN apt-get update && apt-get install -y poppler-utils fonts-dejavu-core && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependencias de Python
RUN pip install fastapi uvicorn python-multipart pdf2image Pillow

COPY main.py .

# Ejecutar la API
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
