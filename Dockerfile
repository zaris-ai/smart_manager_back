FROM node:20-bookworm-slim

WORKDIR /app

# Install Python for repository-analysis child processes.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=development \
    PORT=4000 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/python

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

# Validate the Python package during image build.
RUN python3 --version \
    && python3 -m compileall -q /app/python \
    && PYTHONPATH=/app/python python3 -c \
       "import repository_analysis; print('Repository analysis pipeline:', repository_analysis.PIPELINE_VERSION)"

EXPOSE 4000

CMD ["npm", "run", "dev"]