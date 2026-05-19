const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function classifyIntent(
  message,
  currentMissing = null
) {

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
planName
payment
human
greeting
unknown
banquet
command
room_availability

Rules:

1. If a booking message contains multiple details in one sentence,
extract ALL detected fields together.

Possible fields:
name
guests
adultsCount
childrenCount
childrenAges
date
roomType
roomsCount
checkIn
checkOut

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

4. If user says:
EP
CP
MAP
breakfast plan
room only
meal plan

type = booking
fields.planName = detected plan

5. If user sends only a person name:
Arun Roy / Rahul / Amit Kumar
type = booking
fields.name = full text

6. If user sends only date:
29/04/2026 or 29-04-2026
type = booking
fields.date = exact text

7. If user says:
1 room
2 rooms
3 room
2 room chahiye
do room

type = booking
fields.roomsCount = number

8. If user says:
2 guests
3 log
hum 4 hai
2 adults

8A. If user says:
2 adults 1 child
4 adults 2 kids
2 adult and 3 children
family of 5 with 2 kids
type = booking
Extract:
fields.adultsCount
fields.childrenCount
If total guests can be determined:
fields.guests = adults + children
type = booking
fields.guests = number

8B. If user sends child ages:
4, 8
6 and 12
kids are 5 and 9
child age 7
type = booking
Extract:
fields.childrenAges = array of numbers

9. If user sends only a number:
1
2
3

First check if current missing booking field = roomsCount:
type = booking
fields.roomsCount = number

else current missing booking field = guests:
type = booking
fields.guests = number
fields.adultsCount = number
fields.childrenCount=0

else if current missing booking field = childrenAges:
type = booking
fields.childrenAges = [numbers]

10. If user says yes/haan/ok/continue/proceed:
type = command

11. If asks photos/images:
type = show_rooms

12. If asks payment/qr/upi:
type = payment

13. If asks human/staff/call:
type = human

14. If asks banquet/ banquet booking/ banquet facilities/ banquet images:
type = banquet

15. If asks hotel facilities:
parking?
wifi?
lift?
breakfast?
pets allowed?
smoking allowed?
any policies related query
type = hotel_question

16. Understand Hinglish:
2 log = 2 guests
room chahiye = booking
photo bhejo = show_rooms

17. If really unsure,no intent found, no current active flow, or message is gibberish or unrelated to hotel stay:
type = unknown

18. If user asks availability, vacancy, available rooms, stay availability,
or asks prices for specific dates:
Examples:
"Is room available tomorrow?"
"Availability for 24 may to 25 may"
"Do you have rooms on 5 June?"
"Can I stay from 24 to 25 May?"
"Available rooms and price?"
"Any vacancy?"
type = room_availability
Extract if available:
fields.checkIn
fields.checkOut
fields.roomType
fields.roomsCount
If user provides a date range with room availability query:
Examples:
24 May to 25 May
24/05/2026 - 25/05/2026
from 24 May until 25 May
type = room_availability
fields.checkIn = first date
fields.checkOut = second date

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