// JSON schema validator (opciono)
db = db.getSiblingDB("yt_trending");

db.runCommand({
  collMod: "videos",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "title"],
      properties: {
        _id: { bsonType: "string" },
        title: { bsonType: "string" },
        channel_title: { bsonType: ["string", "null"] },
        category_id: { bsonType: ["int", "null"] },
        publishedAt: { bsonType: ["string", "date", "null"] },
        tags: { bsonType: ["array", "null"] },
        countries: { bsonType: ["array", "null"] },
        trending: {
          bsonType: ["array", "null"],
          items: {
            bsonType: "object",
            required: ["date", "country"],
            properties: {
              date: { bsonType: ["string", "date"] },
              country: { bsonType: "string" },
              views: { bsonType: ["long", "int", "null"] },
              likes: { bsonType: ["long", "int", "null"] },
              comments: { bsonType: ["long", "int", "null"] },
              rank: { bsonType: ["int", "null"] }
            }
          }
        }
      }
    }
  }
})
