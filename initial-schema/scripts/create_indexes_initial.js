// Indeksi za početnu šemu (ugnježđeni niz trending[])
// use yt_trending; (nepotrebno - vec je u connection string-u)

db.videos.createIndex({ "category_id": 1, "trending.country": 1 });
db.videos.createIndex({ "trending.country": 1, "trending.date": 1 });
db.videos.createIndex({ "channel_title": 1 });
