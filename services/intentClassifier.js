const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function classifyIntent(message, currentMissing = null) {

const prompt = `
Return ONLY JSON:

{
 type:"",
 confidence:0.0,
 fields:{}
}

Allowed types:
booking
show_rooms
hotel_question
pricing
policy
payment
human
greeting
unknown
command

Current missing booking field: ${currentMissing || "none"}

Rules:

1. If a booking message contains multiple details in one sentence,
extract ALL detected fields together.

Possible fields:
name
guests
date
roomType
roomsCount

For example: Tarak mehta book for 3 guests on 04/05/2026
type = booking
fields.name = Tarak mehta
fields.guests = 3
fields.date = 04/05/2026

2. If user wants room / stay / reserve / book:
type = booking

3. If user sends room type only:
Deluxe / Suite / Standard / Super Deluxe
type = booking
fields.roomType = detected room name

4. If user sends only a person name:
Arun Roy / Rahul / Amit Kumar
type = booking
fields.name = full text

5. If user sends only date:
29/04/2026 or 29-04-2026
type = booking
fields.date = exact text

6. If user says:
1 room
2 rooms
3 room
2 room chahiye
do room

type = booking
fields.roomsCount = number

7. If user says:
2 guests
3 log
hum 4 hai
2 adults

type = booking
fields.guests = number

8. If user sends only a number:
1
2
3

If current missing booking field = roomsCount:
type = booking
fields.roomsCount = number

If current missing booking field = guests:
type = booking
fields.guests = number

9. If user says yes/haan/ok/continue/proceed:
type = command

10. If asks photos/images:
type = show_rooms

11. If asks payment/qr/upi:
type = payment

12. If asks human/staff/call:
type = human

13. If asks hotel facilities:
parking?
wifi?
lift?
breakfast?
type = hotel_question

14. Understand Hinglish:
2 log = 2 guests
room chahiye = booking
photo bhejo = show_rooms

15. If unsure:
type = unknown

RETURN JSON only.
`;

 const res = await openai.chat.completions.create({
   model: "gpt-4o",
   temperature: 0,
   messages: [
     { role: "system", content: prompt },
     { role: "user", content: message }
   ]
 });

 return JSON.parse(
   res.choices[0].message.content.replace(/```json|```/g, "")
 );
}

module.exports = classifyIntent;