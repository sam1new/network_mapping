FROM python:3.10-slim

# Install system dependencies for Odoo
RUN apt-get update && apt-get install -y \
    libldap2-dev libsasl2-dev gcc python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN pip install --no-cache-dir -r requirements.txt

# Start Odoo
CMD python odoo-bin --db_host=$DB_HOST --db_user=$DB_USER --db_password=$DB_PASSWORD --database=$DB_NAME --http-port=10000