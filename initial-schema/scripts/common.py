import os
import re
from datetime import datetime

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "yt_trending")
DATA_DIR = os.getenv("DATA_DIR", "../../data")
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "5000"))

def parse_trending_date(s: str):
    """Kaggle (npr. '17.14.11' -> 2017-11-14)."""
    if not isinstance(s, str):
        return None
    s = s.strip()
    m = re.match(r"^(\d{2})\.(\d{2})\.(\d{2})$", s)
    if m:
        yy, dd, mm = m.groups()
        year = 2000 + int(yy)
        try:
            return datetime(year, int(mm), int(dd))
        except ValueError:
            pass
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            pass
    return None

def norm_tag(t: str | None):
    if t is None:
        return None
    t = t.strip()
    if not t:
        return None
    return re.sub(r"\s+", " ", t).lower()
