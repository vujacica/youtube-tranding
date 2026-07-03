/*
STUDENT 1 – 5 pitanja nad OPTIMIZOVANOM šemom (trending_daily flat)
Kolekcija: db.trending_daily
*/
use yt_trending;

print("\nQ1 – OPT: avg trending days by category & country");

const q1_opt = db.trending_daily_raw.aggregate([
  { $group: { _id: { vid: "$video_id", c: "$country", d: "$date" } } },
  { $group: { _id: { vid: "$_id.vid", c: "$_id.c" }, days: { $sum: 1 } } },
  { $lookup: {
      from: "videos",
      let: { vid: "$_id.vid" },
      pipeline: [
        { $match: { $expr: { $eq: ["$_id", "$$vid"] } } },
        { $project: { _id: 0, category_id: 1 } }
      ],
      as: "v"
  }},
  { $set: { category_id: { $first: "$v.category_id" } } },
  { $match: { category_id: { $ne: null } } },
  { $lookup: {
      from: "categories",
      localField: "category_id",
      foreignField: "_id",
      as: "cat"
  }},
  { $set: { category: { $first: "$cat.title" } } },
  { $group: {
      _id: { cat: "$category", country: "$_id.c" },
      avgDays: { $avg: "$days" },
      nVideos: { $sum: 1 }
  }},
  { $project: {
      _id: 0,
      category: "$_id.cat",
      country: "$_id.country",
      avgDays: { $round: ["$avgDays", 2] },
      nVideos: 1
  }},
  { $sort: { country: 1, category: 1 } }
], { allowDiskUse: true });

printjson(q1_opt.toArray().slice(0, 10));


print("\nQ2 – OPT: successful video rate by channel (>=3 days)");

const q2_opt = db.trending_daily_raw.aggregate([
  { $group: { _id: { vid: "$video_id", d: "$date" } } },
  { $group: { _id: "$_id.vid", days: { $sum: 1 } } },
  { $set: { isSuccessful: { $gte: ["$days", 3] } } },
  { $lookup: {
      from: "videos",
      let: { vid: "$_id" },
      pipeline: [
        { $match: { $expr: { $eq: ["$_id", "$$vid"] } } },
        { $project: { _id: 0, channel_title: 1 } }
      ],
      as: "v"
  }},
  { $set: { ch: { $first: "$v.channel_title" } } },
  { $match: { ch: { $type: "string", $ne: "" } } },
  { $group: {
      _id: "$ch",
      total: { $sum: 1 },
      succ:  { $sum: { $cond: ["$isSuccessful", 1, 0] } }
  }},
  { $project: {
      _id: 0,
      channel_title: "$_id",
      total_videos: "$total",
      success_rate: {
        $cond: [{ $eq: ["$total", 0] }, 0, { $divide: ["$succ", "$total"] }]
      }
  }},
  { $sort: { success_rate: -1, total_videos: -1, channel_title: 1 } },
  { $limit: 20 }
]);

printjson(q2_opt.toArray());


print("\nQ3 – OPT: top 3 avg daily view growth by country & month");

const q3_opt = db.trending_daily_raw.aggregate([
  { $set: {
      d: { $dateFromString: { dateString: "$date", onError: null, onNull: null } }
  }},
  { $match: { d: { $ne: null } } },
  { $set: {
      ym: { $dateToString: { format: "%Y-%m", date: "$d" } }
  }},
  // 2) prozor po (video, country, ym) sortiran po datumu
  { $setWindowFields: {
      partitionBy: { vid: "$video_id", c: "$country", ym: "$ym" },
      sortBy: { d: 1 },
      output: {
        prevViews: { $shift: { by: -1, output: "$views" } } // ili by: 1 u zavisnosti od željenog smera
      }
  }},
  { $set: {
      prevViews: { $shift: { by: 1, output: "$views" } }   // “trenutni - prethodni”
  }},
  { $set: {
      delta: {
        $cond: [
          { $and: [{ $isNumber: "$views" }, { $isNumber: "$prevViews" }] },
          { $subtract: ["$views", "$prevViews"] },
          null
        ]
      }
  }},
  { $match: { delta: { $ne: null } } },
  { $group: {
      _id: { vid: "$video_id", c: "$country", ym: "$ym" },
      avgGrowth: { $avg: "$delta" },
      title: { $first: "$title" } // nema u RAW; uzme iz videos:
  }},
  // Ako u RAW nema title, povuce iz videos:
  { $lookup: {
      from: "videos",
      let: { vid: "$_id.vid" },
      pipeline: [
        { $match: { $expr: { $eq: ["$_id", "$$vid"] } } },
        { $project: { _id: 0, title: 1 } }
      ],
      as: "v"
  }},
  { $set: { title: { $ifNull: ["$title", { $first: "$v.title" }] } } },
  { $sort: { "_id.c": 1, "_id.ym": 1, avgGrowth: -1 } },
  { $group: {
      _id: { c: "$_id.c", ym: "$_id.ym" },
      top: { $push: { vid: "$_id.vid", title: "$title", avgGrowth: "$avgGrowth" } }
  }},
  { $project: {
      _id: 0, country: "$_id.c", ym: "$_id.ym", top3: { $slice: ["$top", 3] }
  }},
  { $limit: 50 }
], { allowDiskUse: true });

printjson(q3_opt.toArray());


print("\nQ4 – OPT: Pearson corr (ln(1+score)) by country");

const q4_opt = db.trending_daily_raw.aggregate([
  { $set: {
      v_num: { $toDouble: { $ifNull: ["$views", 0] } },
      l_num: { $toDouble: { $ifNull: ["$likes", 0] } }
  }},
  { $set: {
      score: {
        $cond: [
          { $gt: ["$v_num", 0] }, "$v_num",
          { $cond: [{ $gt: ["$l_num", 0] }, "$l_num", 0] }
        ]
      }
  }},
  { $group: {
      _id: { vid: "$video_id", c: "$country" },
      avg_score: { $avg: "$score" }
  }},
  { $lookup: {
      from: "videos",
      let: { vid: "$_id.vid" },
      pipeline: [
        { $match: { $expr: { $eq: ["$_id", "$$vid"] } } },
        { $project: { _id: 0, title: 1, tags: 1 } }
      ],
      as: "v"
  }},
  { $set: {
      title: { $ifNull: [{ $first: "$v.title" }, "" ] },
      tags:  { $ifNull: [{ $first: "$v.tags"  }, [] ] }
  }},
  { $project: {
      c: "$_id.c",
      title_len: { $strLenCP: "$title" },
      tag_count: { $cond: [{ $isArray: "$tags" }, { $size: "$tags" }, 0] },
      log_score: { $ln: { $add: [1, { $ifNull: ["$avg_score", 0] }] } }
  }},
  { $match: { log_score: { $gt: 0 } } },

  // 5) Pearson agregat po zemlji 
  { $group: {
      _id: "$c", n: { $sum: 1 },

      sx1:   { $sum: "$title_len" },
      sy:    { $sum: "$log_score" },
      sx1_2: { $sum: { $multiply: ["$title_len", "$title_len"] } },
      sy_2:  { $sum: { $multiply: ["$log_score", "$log_score"] } },
      sxy1:  { $sum: { $multiply: ["$title_len", "$log_score"] } },

      sx2:   { $sum: "$tag_count" },
      sx2_2: { $sum: { $multiply: ["$tag_count", "$tag_count"] } },
      sxy2:  { $sum: { $multiply: ["$tag_count", "$log_score"] } }
  }},
  { $project: {
      _id: 0, country: "$_id", n_samples: "$n",
      corr_title_len_logscore: {
        $let: {
          vars: { n:"$n", sx:"$sx1", sy:"$sy", sx2:"$sx1_2", sy2:"$sy_2", sxy:"$sxy1" },
          in: { $divide: [
            { $subtract: [ { $multiply:["$$n","$$sxy"] }, { $multiply:["$$sx","$$sy"] } ] },
            { $sqrt: {
              $multiply: [
                { $subtract: [ { $multiply:["$$n","$$sx2"] }, { $multiply:["$$sx","$$sx"] } ] },
                { $subtract: [ { $multiply:["$$n","$$sy2"] }, { $multiply:["$$sy","$$sy"] } ] }
              ] } }
          ] }
        }
      },
      corr_tag_count_logscore: {
        $let: {
          vars: { n:"$n", sx:"$sx2", sy:"$sy", sx2:"$sx2_2", sy2:"$sy_2", sxy:"$sxy2" },
          in: { $divide: [
            { $subtract: [ { $multiply:["$$n","$$sxy"] }, { $multiply:["$$sx","$$sy"] } ] },
            { $sqrt: {
              $multiply: [
                { $subtract: [ { $multiply:["$$n","$$sx2"] }, { $multiply:["$$sx","$$sx"] } ] },
                { $subtract: [ { $multiply:["$$n","$$sy2"] }, { $multiply:["$$sy","$$sy"] } ] }
              ] } }
          ] }
        }
      }
  }},
  { $sort: { country: 1 } }
], { allowDiskUse: true });

printjson(q4_opt.toArray());


print("\nQ5 – OPT: videos trending in >=4 countries (+ total trending days)");
const q5_opt = db.trending_daily_raw.aggregate([
  { $group: { _id: { vid: "$video_id", c: "$country", d: "$date" } } },
  { $group: { _id: { vid: "$_id.vid", c: "$_id.c" }, days: { $sum: 1 } } },
  { $group: {
      _id: "$_id.vid",
      countries: { $addToSet: "$_id.c" },
      totalDays: { $sum: "$days" }
  }},
  { $match: { $expr: { $gte: [ { $size: "$countries" }, 4 ] } } },
  { $project: { _id: 0, video_id: "$_id", countries: 1, totalDays: 1 } },
  { $sort: { totalDays: -1 } },
  { $limit: 50 }
], { allowDiskUse: true });

printjson(q5_opt.toArray());
