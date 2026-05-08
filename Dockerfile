FROM python:3.10-slim

# Install system dependencies for Odoo and PostgreSQL
RUN apt-get update && apt-get install -y \
    libldap2-dev \
    libsasl2-dev \
    gcc \
    python3-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# Install dependencies
RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Start Odoo
CMD python odoo-bin --addons-path=/app/custom_addons,/app/addons,/app/odoo/addons --db_host=$DB_HOST --db_user=$DB_USER --db_password=$DB_PASSWORD --database=$DB_NAME --http-port=8069