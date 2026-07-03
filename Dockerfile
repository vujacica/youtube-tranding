FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini git curl && rm -rf /var/lib/apt/lists/*

# Instalacija mongosh direktno preko .deb paketa (zaobilazi problem sa MongoDB APT ključem)
RUN curl -fsSL -o /tmp/mongosh.deb \
      https://downloads.mongodb.com/compass/mongodb-mongosh_2.3.2_amd64.deb \
    && apt-get update \
    && apt-get install -y /tmp/mongosh.deb \
    && rm -rf /tmp/mongosh.deb /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir flask
COPY . /app

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash"]