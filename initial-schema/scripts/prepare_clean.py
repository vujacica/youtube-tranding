
from pathlib import Path
import sys, os
import pandas as pd

sys.path.append(os.path.dirname(__file__))
from common import parse_trending_date, norm_tag, DATA_DIR

ROOT = Path(DATA_DIR)
assert ROOT.exists(), f"DATA_DIR ne postoji: {ROOT.resolve()}"

countries = [p for p in ROOT.iterdir() if p.is_dir()]
print("Zemlje:", ", ".join(p.name for p in countries))

for country_dir in countries:
    ccode = country_dir.name.upper()
    csv = None
    cat = None
    for p in country_dir.iterdir():
        n = p.name.lower()
        if n.endswith("_youtube_trending_data.csv"):
            csv = p
        elif n.endswith("_category_id.json"):
            cat = p
    if csv is None or cat is None:
        print(f"[WARN] Preskačem {ccode}: fali CSV ili _category_id.json")
        continue

    # --- ČITANJE CSV-a---
    df = pd.read_csv(
        csv,
        keep_default_na=False,  # "" ostaje "", ne NaN
    )

    # koomb na jedinstvena imena
    CANDIDATES = {
        "video_id":         ["video_id", "videoId"],
        "trending_date":    ["trending_date", "trendingDate"],
        "title":            ["title"],
        "channel_title":    ["channel_title", "channelTitle"],
        "category_id":      ["category_id", "categoryId"],
        "publishedAt":      ["publish_time", "publishedAt", "published_at"],
        "tags":             ["tags"],
        "views":            ["view_count", "views"],
        "likes":            ["likes"],
        "dislikes":         ["dislikes"],
        "comments":         ["comment_count", "comments"],
        "description":      ["description"],
        "country":          ["country"],  # ne postoji u raw fajlu, dodajem dole
    }


    # napravila rename mapu
    rename_map = {}
    cols_lower = {c.lower(): c for c in df.columns}  # za ignor malo/veliko

    for target, options in CANDIDATES.items():
        for opt in options:
            # traži egzaktno ime ili case-insensitive
            if opt in df.columns:
                rename_map[opt] = target
                break
            if opt.lower() in cols_lower:
                rename_map[cols_lower[opt.lower()]] = target
                break

    df = df.rename(columns=rename_map)

    # ---  sve bitne kol postoje (ako ne kreiram prazne) ---
    REQUIRED = [
        "video_id", "trending_date", "title", "channel_title", "category_id",
        "publishedAt", "tags", "views", "likes", "comments", "description"
    ]
    for col in REQUIRED:
        if col not in df.columns:
            # string polja - ""
            if col in ("title", "channel_title", "publishedAt", "description"):
                df[col] = ""
            # list polja- prazna lista 
            elif col == "tags":
                df[col] = ""
            else:
                df[col] = None #br


    # --- TAGS normalizacija ---
    def split_tags(x: str):
        if not isinstance(x, str):
            return []
        s = x.strip()
        if not s or s.lower() in ("[none]", "none", "null"):
            return []
        parts = [norm_tag(t) for t in s.split("|")]
        return [t for t in parts if t]

    df["tags"] = df.get("tags", "").apply(split_tags)
    df["tag_count"] = df["tags"].apply(len)


    # --- string polja i bris  NaN/None u "" ---
    df["title"] = df["title"].astype(str)
    df["channel_title"] = df["channel_title"].astype(str)

    df["channel_title"] = df["channel_title"].apply(
        lambda s: (s or "").strip() if (s or "").strip().lower() not in {"nan","none","null"} else ""
    )

    df["title_len"] = df["title"].apply(len)
    df["country"] = ccode

    # --- datum ---
    dt = df["trending_date"].apply(parse_trending_date)
    df["date"] = pd.to_datetime(dt, errors="coerce").dt.strftime("%Y-%m-%d")

    # --- numerick ---
    for col in ["views", "likes", "comments"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")


    # --- novi  trending dnevni csv ---
    cols_tr = ["video_id", "country", "date", "views", "likes", "comments"]
    for c in cols_tr:
        if c not in df.columns:
            df[c] = None
    dft = df[cols_tr].copy()
    (country_dir / "_prepared_trending.csv").write_text(dft.to_csv(index=False), encoding="utf-8")

    # --- videos (po video_id, prvi hronoloski red) ---
    dfv = df.sort_values(["video_id", "date"]).groupby("video_id", as_index=False).first()
    keep = ["video_id","title","channel_title","category_id","publishedAt","tags","tag_count","title_len","country"]
    for c in keep:
        if c not in dfv.columns:
            dfv[c] = None
    (country_dir / "_prepared_videos.csv").write_text(dfv[keep].to_csv(index=False), encoding="utf-8")

    print(f"[OK] {ccode} → _prepared_videos.csv ({len(dfv)}), _prepared_trending.csv ({len(dft)})")
