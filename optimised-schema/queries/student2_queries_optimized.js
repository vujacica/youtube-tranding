// ---------------- TIMING HELPERS ----------------
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


timeBlock("Q1-OPT — avg days publish → first trending (by category & country)", () => {
  print("\nQ1-OPT — avg days from publish to first trending by category & country");

  const cursor = db.q1_video_country_days.aggregate([
    { $project: { _id: 0, category_id: 1, country: 1, days_to_first: 1 } },

    {
      $group: {
        _id: { cat: "$category_id", c: "$country" },
        avgDays: { $avg: "$days_to_first" },
        nVideos: { $sum: 1 }
      }
    },

    {
      $lookup: {
        from: "categories",
        let: { catId: "$_id.cat" },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$catId"] } } },
          { $project: { _id: 0, title: 1 } },
          { $limit: 1 }
        ],
        as: "catDoc"
      }
    },

    {
      $project: {
        _id: 0,
        country: "$_id.c",
        category: { $ifNull: [{ $first: "$catDoc.title" }, "UNKNOWN_CATEGORY"] },
        avgDays: { $round: ["$avgDays", 2] },
        nVideos: 1
      }
    },

    { $sort: { country: 1, category: 1 } }
  ], { allowDiskUse: true });

  const arr = cursor.toArray();
  printjson(arr.slice(0, 20));
});


timeBlock("Q2 — avg engagement per day by category & country (PRECOMPUTED)", () => {
  print("\nQ2 — avg engagement per day by category & country (PRECOMPUTED)");

  const cur = db.getSiblingDB("yt_trending")
    .q8_category_country_engagement_day
    .aggregate([
      // po želji: izbaci grupe sa premalo videa
      { $match: { n_videos: { $gte: 5 } } },

      // primjer: top rezultati globalno
      { $sort: { avg_engagement_per_day: -1, n_videos: -1, country: 1, category_id: 1 } },
      { $limit: 50 }
    ]);

  printjson(cur.toArray());
});







timeBlock("Q3-OPT — comment/like ratio per category (PRECOMPUTED)", () => {
  print("\nQ3-OPT — comment/like ratio per category (PRECOMPUTED)");

  const cur = db.q3_category_totals.aggregate([
    {
      $lookup: {
        from: "categories",
        localField: "category_id",
        foreignField: "_id",
        pipeline: [
          { $project: { _id: 0, title: 1 } },
          { $limit: 1 }
        ],
        as: "catDoc"
      }
    },
    {
      $project: {
        _id: 0,
        category: { $ifNull: [{ $first: "$catDoc.title" }, "UNKNOWN_CATEGORY"] },
        total_likes: 1,
        total_comments: 1,
        comment_like_ratio: 1
      }
    },
    { $sort: { comment_like_ratio: -1, category: 1 } }
  ]);

  printjson(cur.toArray());
});



timeBlock("Q4-OPT — biggest views oscillation per video & country (PRECOMPUTED)", () => {
  print("\nQ4-OPT — biggest views oscillation per video & country (PRECOMPUTED)");

  const cur = db.q4_video_country_osc.aggregate([
    { $sort: { oscillation: -1 } },
    { $limit: 50 }
  ]);

  printjson(cur.toArray());
});



timeBlock("Q5-OPT — top channels by TOTAL VIEWS while trending (PRECOMPUTED)", () => {
  print("\nQ5-OPT — top channels by TOTAL VIEWS while trending (PRECOMPUTED)");

  const cur = db.q5_country_quarter_channel_views.aggregate([
    { $sort: { country: 1, quarter: 1, total_views_trending: -1, channel: 1 } },

    {
      $group: {
        _id: { c: "$country", q: "$quarter" },
        top5: {
          $push: {
            channel: "$channel",
            total_views_trending: "$total_views_trending"
          }
        }
      }
    },

    {
      $project: {
        _id: 0,
        country: "$_id.c",
        quarter: "$_id.q",
        top5: { $slice: ["$top5", 5] }
      }
    },

    { $limit: 200 }
  ]);

  printjson(cur.toArray());
});




emitTimings();