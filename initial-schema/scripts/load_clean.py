"""
Učitavanje u MongoDB i formiranje početne šeme:
- Kolekcije: categories, countries, videos, trending_daily_raw
- Popunjava videos.trending[] agregacijom iz trending_daily_raw
- VAŽNO: koristi $set (ne samo $setOnInsert) da uvek osveži meta podatke (channel_title, itd.)
"""
import json, ast
from pathlib import Path
import sys, os
import pandas as pd
from pymongo import MongoClient, UpdateOne

sys.path.append(os.path.dirname(__file__))
from common import MONGODB_URI, DB_NAME, DATA_DIR, BATCH_SIZE

client = MongoClient(MONGODB_URI)
db = client[DB_NAME]
ROOT = Path(DATA_DIR)

categories = db["categories"]
countries = db["countries"]
videos = db["videos"]
traw = db["trending_daily_raw"]

# indeksi
traw.create_index([("video_id", 1)])
traw.create_index([("country", 1), ("date", 1), ("video_id", 1)])
videos.create_index([("category_id", 1)])
videos.create_index([("channel_title", 1)])

def parse_tags_cell(v):
    if isinstance(v, list):
        return [str(t).strip().lower() for t in v if str(t).strip()]
    if v is None:
        return []
    if isinstance(v, float):
        return []
    if isinstance(v, str):
        s = v.strip()
        if not s or s.lower() in ("[none]", "none", "nan", "null"):
            return []
        try:
            x = ast.literal_eval(s)   #Python obj
            if isinstance(x, list):
                return [str(t).strip().lower() for t in x if str(t).strip()]
        except Exception:
            pass
        try:
            x = json.loads(s)   # json listu
            if isinstance(x, list):
                return [str(t).strip().lower() for t in x if str(t).strip()]
        except Exception:
            pass
        if "|" in s:
            return [t.strip().lower() for t in s.split("|") if t.strip()]
        if "," in s:
            return [t.strip().lower() for t in s.split(",") if t.strip()]
        return [s.lower()]
    return []



for country_dir in [p for p in ROOT.iterdir() if p.is_dir()]:
    ccode = country_dir.name.upper()
    print(f"=== {ccode} ===")

    countries.update_one({"_id": ccode}, {"$set": {"name": ccode}}, upsert=True)

    # categories
    cat_json = next((p for p in country_dir.iterdir() if p.name.lower().endswith("_category_id.json")), None)
    if cat_json and cat_json.exists():
        data = json.loads(cat_json.read_text(encoding="utf-8"))
        for it in data.get("items", []):
            try:
                cid = int(it["id"]) if isinstance(it.get("id"), str) else it.get("id")
            except Exception:
                cid = None
            title = it.get("snippet", {}).get("title")
            if cid is not None and title:
                categories.update_one({"_id": cid}, {"$set": {"title": title}}, upsert=True)

    # videos (VAŽNO: $set + $addToSet)
    pv = country_dir / "_prepared_videos.csv"
    if pv.exists():
        dfv = pd.read_csv(pv, keep_default_na=False)
        ops = []
        for _, r in dfv.iterrows():
            vid = r.get("video_id")
            if not isinstance(vid, str) or not vid:
                continue
            doc_set = {
                "title": r.get("title") or "",
                "channel_id": None,  # dataset nema channelId
                "channel_title": (str(r.get("channel_title")).strip() or None),
                "category_id": int(r.get("category_id")) if str(r.get("category_id")).isdigit() else None,
                "publishedAt": r.get("publishedAt") or None,
                "tags": parse_tags_cell(r.get("tags")),
            }
            ops.append(UpdateOne(
                {"_id": vid},
                {
                    "$setOnInsert": {"_id": vid},
                    "$set": doc_set,
                    "$addToSet": {"countries": ccode}
                },
                upsert=True
            ))
            if len(ops) >= BATCH_SIZE:
                videos.bulk_write(ops, ordered=False); ops.clear()
        if ops:
            videos.bulk_write(ops, ordered=False)
        print(f"[OK] videos upsert/update ({len(dfv)})")

    # trending_daily_raw
    pt = country_dir / "_prepared_trending.csv"
    if pt.exists():
        dft = pd.read_csv(pt, keep_default_na=False)
        ops = []
        for _, r in dft.iterrows():
            vid = r.get("video_id")
            if not isinstance(vid, str) or not vid:
                continue
            def as_int(x):
                try:
                    return int(float(x))
                except Exception:
                    return None
            ops.append(UpdateOne(
                {"video_id": vid, "country": ccode, "date": r.get("date")},
                {"$set": {
                    "video_id": vid,
                    "country": ccode,
                    "date": r.get("date"),
                    "views": as_int(r.get("views")),
                    "likes": as_int(r.get("likes")),
                    "comments": as_int(r.get("comments")),
                    "rank": None
                }},
                upsert=True
            ))
            if len(ops) >= BATCH_SIZE:
                traw.bulk_write(ops, ordered=False); ops.clear()
        if ops:
            traw.bulk_write(ops, ordered=False)
        print(f"[OK] trending_daily_raw upsert ({len(dft)})")

# AGG: popuni videos.trending i countries (potpuno iz RAW)
pipeline = [
  {"$group": {
      "_id": "$video_id",
      "trending": {"$push": {
          "date": "$date",
          "country": "$country",
          "views": "$views",
          "likes": "$likes",
          "comments": "$comments",
          "rank": "$rank"
      }},
      "countries": {"$addToSet": "$country"}
  }},
  {"$merge": {
      "into": "videos",
      "on": "_id",
      "whenMatched": [
        {"$set": {
           "trending": "$$new.trending",
           "countries": { "$setUnion": [ { "$ifNull": ["$countries", []] }, "$$new.countries" ] }
        }}
      ],
      "whenNotMatched": "discard"
  }}
]
print("[AGG] Popunjavanje videos.trending ...")
db.command("aggregate", "trending_daily_raw", pipeline=pipeline, cursor={})
print("[DONE]")
