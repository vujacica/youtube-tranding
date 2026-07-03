/*
STUDENT 1 – 5 pitanja nad POČETNOM šemom (videos sa trending[])
Kolekcija: db.videos
*/
/*use yt_trending;

// 1) Za svaku kategoriju i zemlju odredi prosečan broj dana koliko video ostaje na trending listi.
print("\nQ1 – avg trending days by category & country");
let q1 = db.videos.aggregate([
  { $unwind: "$trending" },
  { $group: {
      _id: { vid: "$_id", cat: "$category_id", c: "$trending.country" },
      days: { $addToSet: "$trending.date" }
  }},
  { $project: { 
    cat: "$_id.cat", country: "$_id.c", days: { $size: "$days" } 
  }},
  { $group: {
     _id: { cat: "$cat", country: "$country" }, avgDays: { $avg: "$days" }, nVideos: { $sum: 1 }
   }},
  { $lookup: { 
    from: "categories", localField: "_id.cat", foreignField: "_id", as: "cat"
   }},
  { $set: {
     category: { $first: "$cat.title" } 
  }},
  { $project: {
    _id: 0, category: 1, country: "$_id.country", avgDays: { $round: ["$avgDays", 2] }, nVideos: 1 
  }},
  { $sort: { country: 1, category: 1 

  } }
]);
printjson(q1.toArray().slice(0, 10));


// Q2  najveci procentan upesnih videa
print("\nQ2 (initial, FAST) – successful video rate by channel");
let q2i_fast = db.trending_daily_raw.aggregate([
  { $group: { _id: { vid: "$video_id", d: "$date" } } },
  { $group: { _id: "$._id.vid", days: { $sum: 1 } } },   //br dana po videu u raw tr
  { $set: { isSuccessful: { $gte: ["$days", 3] } } },  // success flag
  { $lookup: { from: "videos", localField: "_id", foreignField: "_id", as: "v" } },
  { $set: { v: { $first: "$v" }, ch: "$v.channel_title" } },
  { $match: { ch: { $type: "string", $ne: "" } } },
  { $group: {
      _id: "$ch",
      total: { $sum: 1 },
      succ:  { $sum: { $cond: [ "$isSuccessful", 1, 0 ] } }
  }},
  { $project: {
      _id: 0,
      channel_title: "$_id",
      total_videos: "$total",
      success_rate: {
        $cond: [ { $eq: ["$total", 0] }, 0, { $divide: ["$succ", "$total"] } ]
      }
  }},
  { $sort: { success_rate: -1, total_videos: -1, channel_title: 1 } },
  { $limit: 20 }
]);
printjson(q2i_fast.toArray());



// 3) top 3 videa za zemlju i mesec po prosecnom dnevnom rastu 
print("\nQ3 – top 3 avg daily view growth by country & month");
let q3 = db.videos.aggregate([
  { $unwind: "$trending" },
  { $set: {
     d: { $toDate: "$trending.date" }
     } },
  { $set: {
     ym: { $dateToString: { format: "%Y-%m", date: "$d" } }, c: "$trending.country", v: "$trending.views"
     } },
  { $sort: {
     "_id": 1, c: 1, ym: 1, d: 1 
    } },
  { $group: { 
    _id: { vid: "$_id", c: "$c", ym: "$ym" }, views: { $push: "$v" }, title: { $first: "$title" }
   }},
  { $project: { 
    c: "$_id.c", ym: "$_id.ym", vid: "$_id.vid", title: 1,
      deltas: { $map: { input: { $range: [1, { $size: "$views" }] }, as: "i",
        in: { $subtract: [ { $arrayElemAt: ["$views", "$$i"] }, { $arrayElemAt: ["$views", { $subtract: ["$$i", 1] }] } ] } } } 
      }},
  { $project: {
     c: 1, ym: 1, vid: 1, title: 1, avgGrowth: { $cond: [ { $gt: [ { $size: "$deltas" }, 0 ] }, { $avg: "$deltas" }, 0 ] } 
    }},
  { $sort: {
     c: 1, ym: 1, avgGrowth: -1 } },
  { $group: { 
    _id: { c: "$c", ym: "$ym" }, top: { $push: { vid: "$vid", title: "$title", avgGrowth: "$avgGrowth" } }
   }},
  { $project: {
     _id: 0, country: "$_id.c", ym: "$_id.ym", top3: { $slice: ["$top", 3] } 
    }},
  { $limit: 50 }
]);
printjson(q3.toArray());


// 4) Da li dužina naslova i broj tagova imaju značajan uticaj na prosečan rang videa?
print("\nQ4c — Pearson (ln(1+score)) by country");
printjson(
  db.videos.aggregate([
    { $unwind: "$trending" },
    { $set: {
        v_num: { $toDouble: { $ifNull: ["$trending.views", 0] } },  //views
        l_num: { $toDouble: { $ifNull: ["$trending.likes", 0] } },  //likes 
        title_safe: { $ifNull: ["$title", ""] },
        tags_safe:  { $ifNull: ["$tags", []] }
    }},

    { $set: { score: {  $cond: [  { $gt: ["$v_num", 0] },   "$v_num",    { $cond: [ { $gt: ["$l_num", 0] }, "$l_num", 0 ] }
          ]
        },
        c: "$trending.country"
    }},
    //  video+država i prosečan score
    { $group: { _id: { vid:"$_id", c:"$c" },
        title: { $first: "$title_safe" },
        tags:  { $first: "$tags_safe"  },
        avg_score: { $avg: "$score" }
    }},

    // feat-ovi + log transformacija (ln(1+avg_score))
    { $project: {
        c: "$_id.c",
        title_len: { $strLenCP: "$title" },
        tag_count: { $cond: [ { $isArray: "$tags" }, { $size: "$tags" }, 0 ] },
        log_score: { $ln: { $add: [1, { $ifNull: ["$avg_score", 0] }] } }
    }},

    // ukloni nule
    { $match: { log_score: { $gt: 0 } } },

    // Pearson r po državi (title_len vs log_score, tag_count vs log_score)
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
      _id: 0, country: "$_id", n_samples:"$n",
      corr_title_len_logscore: {
        $let: {
          vars: { n:"$n", sx:"$sx1", sy:"$sy", sx2:"$sx1_2", sy2:"$sy_2", sxy:"$sxy1" },
          in: { $divide: [
            { $subtract: [ { $multiply:["$$n","$$sxy"] }, { $multiply:["$$sx","$$sy"] } ] },
            { $sqrt: {
              $multiply: [
                { $subtract: [ { $multiply:["$$n","$$sx2"] }, { $multiply:["$$sx","$$sx"] } ] },
                { $subtract: [ { $multiply:["$$n","$$sy2"] }, { $multiply:["$$sy","$$sy"] } ] }
              ]}}
          ]}}
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
              ]}}
          ]}}
      }
    }},
    { $sort: { country: 1 } }
  ]).toArray()
);



// 5) videi koji su u trendingu u najmanje 4 z, i ukupni dani na trend list
print("\nQ5 – videos trending in >=4 countries (+ total trending days)");
let q5 = db.videos.aggregate([
  { $unwind: "$trending" },
  { $group: {
     _id: { vid: "$_id", c: "$trending.country" }, days: { $addToSet: "$trending.date" } 
    }},
  //  { $lookup: { 
  //   from: "videos", localField: "vid", foreignField: "_id", as: "video"
  //  }},
  { $group: { 
    _id: "$_id.vid", countries: { $addToSet: "$_id.c" }, totalDays: { $sum: { $size: "$days" } } 
  }},
  { $match: { 
    $expr: { $gte: [ { $size: "$vid.tag" }, 3 ] }
   } },
  { $project: {
     _id: 0, video_id: "$_id", countries: 1, totalDays: 1 
    } },
  { $sort: { totalDays: -1 } },
  { $limit: 50 }
]);
printjson(q5.toArray());

*/
let q6 =db.videos.aggregate([
{$match:{
  $expr:{$gt:[ {$size: "$videos.tags"},3]}
}},

{$project:{
  vid:"$_id"
}}

]);
printjson(q6.toArray());
