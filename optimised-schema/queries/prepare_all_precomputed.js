print("======================================");
print("[PREPARE Q1+Q2+Q3+Q4+Q5] START");
print("======================================");

// =====================================================
// GLOBAL
// =====================================================

print("[PREPARE] Ensuring d: Date ...");
db.trending_daily_raw.updateMany(
  { d: { $exists: false } },
  [{
    $set: {
      d: {
        $dateFromString: {
          dateString: "$date",
          onError: null,
          onNull: null
        }
      }
    }
  }]
);

print("[PREPARE] Ensuring rank_num ...");
db.trending_daily_raw.updateMany(
  { rank_num: { $exists: false } },
  [{
    $set: {
      rank_num: { $toDouble: { $ifNull: ["$rank", "$position"] } }
    }
  }]
);
print("[PREPARE] Ensuring likes_num / comments_num ...");

db.trending_daily_raw.updateMany(
  { likes_num: { $exists: false } },
  [{ $set: { likes_num: { $toDouble: { $ifNull: ["$likes", 0] } } } }]
);

db.trending_daily_raw.updateMany(
  { comments_num: { $exists: false } },
  [{
    $set: {
      comments_num: {
        $toDouble: { $ifNull: ["$comment_count", { $ifNull: ["$comments", 0] }] }
      }
    }
  }]
);




// =====================================================
// Q1 — avg days publish → first trending
// =====================================================

print("[Q1 PREPARE] Rebuilding q1_video_country_days...");
db.q1_video_country_days.drop();

db.trending_daily_raw.aggregate([
  { $match: { d: { $type: "date" } } },

  {
    $group: {
      _id: { vid: "$video_id", c: "$country" },
      first_tr_dt: { $min: "$d" }
    }
  },

  {
    $lookup: {
      from: "videos",
      let: { vid: "$_id.vid" },
      pipeline: [
        { $match: { $expr: { $eq: ["$_id", "$$vid"] } } },
        { $project: { _id: 0, category_id: 1, publishedAt: 1, publish_time: 1 } },
        { $limit: 1 }
      ],
      as: "v"
    }
  },
  { $set: { v0: { $first: "$v" } } },

  {
    $set: {
      category_id: "$v0.category_id",
      publish_dt: {
        $ifNull: [
          { $convert: { input: "$v0.publishedAt", to: "date", onError: null, onNull: null } },
          { $convert: { input: "$v0.publish_time", to: "date", onError: null, onNull: null } }
        ]
      }
    }
  },

  { $match: { publish_dt: { $type: "date" }, category_id: { $ne: null } } },

  {
    $set: {
      days_to_first: {
        $divide: [
          { $subtract: ["$first_tr_dt", "$publish_dt"] },
          1000 * 60 * 60 * 24
        ]
      }
    }
  },
  { $match: { days_to_first: { $gte: 0 } } },

  {
    $project: {
      _id: 0,
      video_id: "$_id.vid",
      country: "$_id.c",
      category_id: 1,
      days_to_first: 1
    }
  },

  { $out: "q1_video_country_days" }
], { allowDiskUse: true });

print("[Q1 PREPARE] DONE.");


// =====================================================
// Q2 PREPARE — avg engagement per day by (category, country)
// engagement_day = likes_num + comments_num
// koristi category_id direktno iz trending_daily_raw
// =====================================================

const dbYT = db.getSiblingDB("yt_trending");

print("======================================");
print("[Q2 PREPARE] START");
print("======================================");

// 0) Provjera da li ima podataka
print("[Q2 PREPARE] trending_daily_raw count = " + dbYT.trending_daily_raw.countDocuments());
print("[Q2 PREPARE] videos count = " + dbYT.videos.countDocuments());

// 1) Osiguraj likes_num/comments_num (brojevi, bez null)
print("[Q2 PREPARE] Ensuring likes_num/comments_num ...");

dbYT.trending_daily_raw.updateMany(
  {},
  [{
    $set: {
      likes_num: {
        $toDouble: { $ifNull: ["$likes_num", { $ifNull: ["$likes", 0] }] }
      },
      comments_num: {
        $toDouble: { $ifNull: ["$comments_num", { $ifNull: ["$comments", { $ifNull: ["$comment_count", 0] }] }] }
      }
    }
  }]
);

// 2) (opciono) d: Date
print("[Q2 PREPARE] Ensuring d: Date ...");

dbYT.trending_daily_raw.updateMany(
  { d: { $exists: false } },
  [{
    $set: {
      d: {
        $dateFromString: {
          dateString: "$date",
          onError: null,
          onNull: null
        }
      }
    }
  }]
);

// 3) Rebuild output kolekcije
print("[Q2 PREPARE] Rebuilding q8_category_country_engagement_day ...");
dbYT.q8_category_country_engagement_day.drop();

dbYT.trending_daily_raw.aggregate([
  {
    $project: {
      video_id: 1,
      country: 1,
      category_id: 1,
      engagement_day: { $add: ["$likes_num", "$comments_num"] }
    }
  },
  {
    $match: {
      video_id: { $type: "string", $ne: "" },
      country: { $type: "string", $ne: "" },
      category_id: { $type: "number" },
      engagement_day: { $type: "number" }
    }
  },

  // po video-u: prosjek engagement-a po danu dok je trending
  {
    $group: {
      _id: { vid: "$video_id", c: "$country", cat: "$category_id" },
      total_engagement: { $sum: "$engagement_day" },
      days_trending: { $sum: 1 }
    }
  },
  {
    $set: {
      engagement_per_day_video: {
        $cond: [
          { $gt: ["$days_trending", 0] },
          { $divide: ["$total_engagement", "$days_trending"] },
          null
        ]
      }
    }
  },
  { $match: { engagement_per_day_video: { $ne: null } } },

  // po (category, country): prosjek preko videa
  {
    $group: {
      _id: { cat: "$_id.cat", c: "$_id.c" },
      avg_engagement_per_day: { $avg: "$engagement_per_day_video" },
      n_videos: { $sum: 1 }
    }
  },
  {
    $project: {
      _id: 0,
      category_id: "$_id.cat",
      country: "$_id.c",
      avg_engagement_per_day: { $round: ["$avg_engagement_per_day", 2] },
      n_videos: 1
    }
  },

  { $sort: { country: 1, category_id: 1 } },
  { $out: "q8_category_country_engagement_day" }
], { allowDiskUse: true });

print("[Q2 PREPARE] q8_category_country_engagement_day count = " + dbYT.q8_category_country_engagement_day.countDocuments());
print("[Q2 PREPARE] DONE");
print("======================================");


// =====================================================
// Q3 — comment/like ratio per category (PRECOMPUTED)
// (bez denormalizacije: uzimamo category_id iz videos preko lookup-a)
// =====================================================

print("[Q3 PREPARE] Rebuilding q3_category_totals...");
db.q3_category_totals.drop();

db.trending_daily_raw.aggregate([
  // numeric conversion samo jednom u precompute-u
  {
    $project: {
      video_id: 1,
      likes: { $toDouble: { $ifNull: ["$likes", 0] } },
      comm: {
        $toDouble: {
          $ifNull: ["$comment_count", { $ifNull: ["$comments", 0] }]
        }
      }
    }
  },

  {
    $lookup: {
      from: "videos",
      let: { vid: "$video_id" },
      pipeline: [
        { $match: { $expr: { $eq: ["$_id", "$$vid"] } } },
        { $project: { _id: 0, category_id: 1 } },
        { $limit: 1 }
      ],
      as: "v"
    }
  },
  { $set: { category_id: { $first: "$v.category_id" } } },
  { $match: { category_id: { $ne: null } } },

  {
    $group: {
      _id: "$category_id",
      total_likes: { $sum: "$likes" },
      total_comments: { $sum: "$comm" }
    }
  },

  {
    $project: {
      _id: 0,
      category_id: "$_id",
      total_likes: 1,
      total_comments: 1,
      comment_like_ratio: {
        $cond: [
          { $gt: ["$total_likes", 0] },
          { $divide: ["$total_comments", "$total_likes"] },
          null
        ]
      }
    }
  },

  { $out: "q3_category_totals" }
], { allowDiskUse: true });

print("[Q3 PREPARE] DONE.");



// =====================================================
// Q4 — biggest views oscillation per video & country (PRECOMPUTED)
// =====================================================

print("[Q4 PREPARE] Rebuilding q4_video_country_osc...");
db.q4_video_country_osc.drop();

db.trending_daily_raw.aggregate([
  {
    $project: {
      video_id: 1,
      country: 1,
      v: { $toDouble: { $ifNull: ["$views", 0] } }
    }
  },

  {
    $group: {
      _id: { vid: "$video_id", c: "$country" },
      v_min: { $min: "$v" },
      v_max: { $max: "$v" }
    }
  },

  {
    $set: {
      oscillation: { $subtract: ["$v_max", "$v_min"] }
    }
  },

  {
    $lookup: {
      from: "videos",
      let: { vid: "$_id.vid" },
      pipeline: [
        { $match: { $expr: { $eq: ["$_id", "$$vid"] } } },
        { $project: { _id: 0, title: 1, channel_title: 1 } },
        { $limit: 1 }
      ],
      as: "v"
    }
  },

  {
    $project: {
      _id: 0,
      video_id: "$_id.vid",
      country: "$_id.c",
      title: { $ifNull: [{ $first: "$v.title" }, null] },
      channel: { $ifNull: [{ $first: "$v.channel_title" }, null] },
      views_min: "$v_min",
      views_max: "$v_max",
      oscillation: 1
    }
  },

  { $out: "q4_video_country_osc" }
], { allowDiskUse: true });

print("[Q4 PREPARE] DONE.");


// =====================================================
// Q5 — top channels by gained views per quarter & country (PRECOMPUTED)
// =====================================================

// =====================================================
// Q5 — top channels by TOTAL VIEWS while trending (PRECOMPUTED)
// =====================================================

print("[Q5 PREPARE] Rebuilding q5_country_quarter_channel_views...");
db.q5_country_quarter_channel_views.drop();

db.trending_daily_raw.aggregate([
  {
    $match: { d: { $type: "date" } }
  },

  {
    $project: {
      video_id: 1,
      country: 1,
      d: 1,
      views: { $toDouble: { $ifNull: ["$views", 0] } }
    }
  },

  // quarter string
  {
    $set: {
      quarter: {
        $concat: [
          { $toString: { $year: "$d" } },
          "-Q",
          {
            $toString: {
              $ceil: { $divide: [{ $month: "$d" }, 3] }
            }
          }
        ]
      }
    }
  },

  // join channel_title
  {
    $lookup: {
      from: "videos",
      let: { vid: "$video_id" },
      pipeline: [
        { $match: { $expr: { $eq: ["$_id", "$$vid"] } } },
        { $project: { _id: 0, channel_title: 1 } },
        { $limit: 1 }
      ],
      as: "v"
    }
  },

  { $set: { channel: { $first: "$v.channel_title" } } },
  { $match: { channel: { $type: "string", $ne: "" } } },

  // total views while trending per (country, quarter, channel)
  {
    $group: {
      _id: { c: "$country", q: "$quarter", ch: "$channel" },
      total_views_trending: { $sum: "$views" }
    }
  },

  {
    $project: {
      _id: 0,
      country: "$_id.c",
      quarter: "$_id.q",
      channel: "$_id.ch",
      total_views_trending: 1
    }
  },

  { $out: "q5_country_quarter_channel_views" }
], { allowDiskUse: true });

print("[Q5 PREPARE] DONE.");








print("======================================");
print("[PREPARE Q1+Q2+Q3] FINISHED");
print("======================================");
