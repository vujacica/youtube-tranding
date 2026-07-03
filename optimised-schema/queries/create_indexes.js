print("\n[INDEX] Creating indexes...");

var db = db.getSiblingDB("yt_trending");

// Q1 precomputed
db.q1_video_country_days.createIndex({ country: 1, category_id: 1 });



// Q3 precomputed
db.q3_category_totals.createIndex({ category_id: 1 });


// Q4 precomputed
db.q4_video_country_osc.createIndex({ oscillation: -1 });       // za sort + limit top 50
db.q4_video_country_osc.createIndex({ video_id: 1, country: 1 });// ako ti treba lookup/filter kasnije

//Q5
db.q5_country_quarter_channel.createIndex(
  { country: 1, quarter: 1, total_gained_views: -1 }
); 
 
db.q5_country_quarter_channel_views.createIndex(
  { country: 1, quarter: 1, total_views_trending: -1 }
);
// RAW shared (korisno za Q1 build i generalno)
db.trending_daily_raw.createIndex({ video_id: 1, country: 1, d: 1 });
db.trending_daily_raw.createIndex({ rank_num: 1 });



// trending_daily_raw — ubrzava match + lookup po video_id + country
db.trending_daily_raw.createIndex({ video_id: 1, country: 1 });

// mapa (podrazumijevano već ima index na _id, ali nije loše ostaviti jasno)
db.q8_video_category_map.createIndex({ _id: 1 });

// precompute rezultat — za brzo filtriranje/sort
db.q8_category_country_engagement_day.createIndex({ country: 1, category_id: 1 });
db.q8_category_country_engagement_day.createIndex({ avg_engagement_per_day: -1 });
print("[INDEX] Done.\n");
