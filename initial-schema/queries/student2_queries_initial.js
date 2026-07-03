// ======================= TIMING HELPERS =======================
const __timings = [];

function timeBlock(label, fn) {
  const t0 = Date.now();
  let ok = true;
  let error = null;

  try {
    fn();
  } catch (e) {
    ok = false;
    error = (e && e.message) ? e.message : String(e);
  }

  const ms = Date.now() - t0;
  __timings.push({ label, ms, ok, error });
}

function emitTimings() {
  print("TIMINGS_JSON:" + JSON.stringify({
    generatedAt: new Date().toISOString(),
    timings: __timings
  }));
}

// =====================================================
// DB (budi eksplicitan da ne bude zabune db vs db2)
// =====================================================
const DB = db.getSiblingDB("yt_trending");

// =====================================================
// Q1 — avg days publish → first trending (by category & country)
// =====================================================
timeBlock("Q1 — avg days publish → first trending (by category & country)", () => {
  print("\nQ1 — avg days from publish to first trending by category & country");

  const cur = DB.videos.aggregate([
    { $unwind: "$trending" },

    // Normalizuj datume: publish i trending date
    {
      $set: {
        publish_dt: {
          $cond: [
            { $ne: ["$publishedAt", null] }, { $toDate: "$publishedAt" },
            {
              $cond: [
                { $ne: ["$publish_time", null] }, { $toDate: "$publish_time" },
                null
              ]
            }
          ]
        },
        tr_dt: { $toDate: "$trending.date" },
        c: "$trending.country",
        cat: "$category_id"
      }
    },

    // Prvo pojavljivanje po (video, zemlja)
    {
      $group: {
        _id: { vid: "$_id", c: "$c" },
        cat: { $first: "$cat" },
        publish_dt: { $first: "$publish_dt" },
        first_tr_dt: { $min: "$tr_dt" }
      }
    },

    // Razlika u danima
    {
      $project: {
        cat: 1,
        c: "$_id.c",
        days_to_first: {
          $cond: [
            {
              $and: [
                { $ne: ["$publish_dt", null] },
                { $ne: ["$first_tr_dt", null] }
              ]
            },
            {
              $divide: [
                { $subtract: ["$first_tr_dt", "$publish_dt"] },
                1000 * 60 * 60 * 24
              ]
            },
            null
          ]
        }
      }
    },

    { $match: { days_to_first: { $ne: null, $gte: 0 } } },

    // Prosek po (kategorija, zemlja)
    {
      $group: {
        _id: { cat: "$cat", c: "$c" },
        avg_days: { $avg: "$days_to_first" },
        n_videos: { $sum: 1 }
      }
    },

    // Naziv kategorije
    {
      $lookup: {
        from: "categories",
        localField: "_id.cat",
        foreignField: "_id",
        as: "cat"
      }
    },
    { $set: { category: { $first: "$cat.title" } } },

    {
      $project: {
        _id: 0,
        category: 1,
        country: "$_id.c",
        avg_days: { $round: ["$avg_days", 2] },
        n_videos: 1
      }
    },
    { $sort: { country: 1, category: 1 } }
  ], { allowDiskUse: true });

  const arr = cur.toArray();
  printjson(arr.slice(0, 20));
});





timeBlock("Q2 — avg engagement per day by category & country (INITIAL)", () => {
  print("\nQ2 — avg engagement per day by category & country (INITIAL)");

  const cur = db.getSiblingDB("yt_trending")
    .trending_daily_raw
    .aggregate([
      // 1) validacija + numerički engagement po danu
      {
        $project: {
          video_id: 1,
          country: 1,
          engagement_day: {
            $add: [
              { $toDouble: { $ifNull: ["$likes_num", "$likes"] } },
              { $toDouble: { $ifNull: ["$comments_num", "$comments"] } }
            ]
          }
        }
      },
      {
        $match: {
          video_id: { $type: "string", $ne: "" },
          country: { $type: "string", $ne: "" },
          engagement_day: { $type: "number" }
        }
      },

      // 2) category_id iz videos (INITIAL lookup)
      {
        $lookup: {
          from: "videos",
          localField: "video_id",
          foreignField: "_id",   // kod tebe je _id = video_id
          as: "v"
        }
      },
      { $set: { category_id: { $first: "$v.category_id" } } },
      { $match: { category_id: { $type: "number" } } },

      // 3) po (video, country, category): total engagement + broj dana
      {
        $group: {
          _id: { vid: "$video_id", c: "$country", cat: "$category_id" },
          total_engagement: { $sum: "$engagement_day" },
          days_trending: { $sum: 1 }
        }
      },

      // 4) engagement/day po videu
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

      // 5) prosjek po (category, country)
      {
        $group: {
          _id: { cat: "$_id.cat", c: "$_id.c" },
          avg_engagement_per_day: { $avg: "$engagement_per_day_video" },
          n_videos: { $sum: 1 }
        }
      },

      // 6) isti filter i sort kao OPT
      { $match: { n_videos: { $gte: 5 } } },
      {
        $project: {
          _id: 0,
          category_id: "$_id.cat",
          country: "$_id.c",
          avg_engagement_per_day: { $round: ["$avg_engagement_per_day", 2] },
          n_videos: 1
        }
      },
      {
        $sort: {
          avg_engagement_per_day: -1,
          n_videos: -1,
          country: 1,
          category_id: 1
        }
      },
      { $limit: 50 }
    ], { allowDiskUse: true });

  printjson(cur.toArray());
});




// =====================================================
// Q3 — comment/like ratio per category (ranked)
// =====================================================
timeBlock("Q3 — comment/like ratio per category (ranked)", () => {
  print("\nQ3 — comment/like ratio by category (ranked)");

  const cur = DB.videos.aggregate([
    { $unwind: "$trending" },
    {
      $set: {
        cat: "$category_id",
        likes: { $toDouble: { $ifNull: ["$trending.likes", 0] } },
        comm: { $toDouble: { $ifNull: ["$trending.comments", 0] } }
      }
    },
    {
      $group: {
        _id: "$cat",
        total_likes: { $sum: "$likes" },
        total_comments: { $sum: "$comm" }
      }
    },
    {
      $set: {
        ratio: {
          $cond: [
            { $gt: ["$total_likes", 0] },
            { $divide: ["$total_comments", "$total_likes"] },
            null
          ]
        }
      }
    },
    {
      $lookup: {
        from: "categories",
        localField: "_id",
        foreignField: "_id",
        as: "cat"
      }
    },
    { $set: { category: { $first: "$cat.title" } } },
    {
      $project: {
        _id: 0,
        category: 1,
        comment_like_ratio: { $round: ["$ratio", 4] },
        total_comments: 1,
        total_likes: 1
      }
    },
    { $sort: { comment_like_ratio: -1, category: 1 } }
  ], { allowDiskUse: true });

  printjson(cur.toArray());
});

// =====================================================
// Q4 — biggest views oscillation (max - min views) per video & country
// =====================================================
timeBlock("Q4 — biggest views oscillation (max-min) per video & country", () => {
  print("\nQ4 — biggest popularity oscillation (max - min views) per video & country");

  const cur = DB.videos.aggregate([
    { $unwind: "$trending" },
    {
      $set: {
        vid: "$_id",
        c: "$trending.country",
        v: { $toDouble: { $ifNull: ["$trending.views", 0] } }
      }
    },
    {
      $group: {
        _id: { vid: "$vid", c: "$c" },
        title: { $first: "$title" },
        channel: { $first: "$channel_title" },
        v_min: { $min: "$v" },
        v_max: { $max: "$v" }
      }
    },
    { $set: { oscillation: { $subtract: ["$v_max", "$v_min"] } } },
    { $sort: { oscillation: -1 } },
    { $limit: 50 },
    {
      $project: {
        _id: 0,
        video_id: "$_id.vid",
        country: "$_id.c",
        title: 1,
        channel: 1,
        views_min: "$v_min",
        views_max: "$v_max",
        oscillation: 1
      }
    }
  ], { allowDiskUse: true });

  printjson(cur.toArray());
});

// =====================================================
// Q5 — top 5 channels by total views gained while trending, per country & quarter
// =====================================================
timeBlock("Q5 — top 5 channels by total gained views (per country & quarter)", () => {
  print("\nQ5 — top 5 channels by total views gained while trending, per country & quarter");

  const cur = DB.videos.aggregate([
    { $unwind: "$trending" },
    {
      $set: {
        vid: "$_id",
        ch: "$channel_title",
        c: "$trending.country",
        d: { $toDate: "$trending.date" },
        v: { $toDouble: { $ifNull: ["$trending.views", 0] } }
      }
    },
    { $match: { ch: { $type: "string", $ne: "" } } },

    { $set: { y: { $year: "$d" }, m: { $month: "$d" } } },
    { $set: { q: { $ceil: { $divide: ["$m", 3] } } } },
    {
      $set: {
        yq: {
          $concat: [{ $toString: "$y" }, "-Q", { $toString: "$q" }]
        }
      }
    },

    { $sort: { vid: 1, c: 1, yq: 1, d: 1 } },

    {
      $group: {
        _id: { vid: "$vid", c: "$c", yq: "$yq" },
        ch: { $first: "$ch" },
        views: { $push: "$v" }
      }
    },

    {
      $project: {
        ch: 1,
        c: "$_id.c",
        yq: "$_id.yq",
        deltas: {
          $map: {
            input: { $range: [1, { $size: "$views" }] },
            as: "i",
            in: {
              $let: {
                vars: {
                  cur: { $arrayElemAt: ["$views", "$$i"] },
                  prev: { $arrayElemAt: ["$views", { $subtract: ["$$i", 1] }] }
                },
                in: {
                  $cond: [
                    { $gt: [{ $subtract: ["$$cur", "$$prev"] }, 0] },
                    { $subtract: ["$$cur", "$$prev"] },
                    0
                  ]
                }
              }
            }
          }
        }
      }
    },

    { $project: { ch: 1, c: 1, yq: 1, gained_views: { $sum: "$deltas" } } },

    {
      $group: {
        _id: { c: "$c", yq: "$yq", ch: "$ch" },
        total_gained_views: { $sum: "$gained_views" }
      }
    },

    { $sort: { "_id.c": 1, "_id.yq": 1, total_gained_views: -1, "_id.ch": 1 } },

    {
      $group: {
        _id: { c: "$_id.c", yq: "$_id.yq" },
        top: {
          $push: {
            channel: "$_id.ch",
            total_gained_views: "$total_gained_views"
          }
        }
      }
    },
    {
      $project: {
        _id: 0,
        country: "$_id.c",
        quarter: "$_id.yq",
        top5: { $slice: ["$top", 5] }
      }
    }
  ], { allowDiskUse: true });

  printjson(cur.toArray().slice(0, 30));
});

// ======================= EMIT TIMINGS =======================
emitTimings();
