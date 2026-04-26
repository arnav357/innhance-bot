const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function classifyIntent(message){

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

If booking is already active and user sends:
Deluxe / Suite / Standard (any room type name) then classify as: booking

If booking is already active and user sends something like:
Yes / Yes continue the bookinig / hmm / haan then classify as: command

NOT show_rooms

Understand Hinglish:
kal = tomorrow
parso = day after tomorrow
2 log = 2 guests
room chahiye = booking
photo bhejo = show_rooms
baat karni hai = human request
`;

 const res = await openai.chat.completions.create({
   model:"gpt-4o",
   temperature:0,
   messages:[
    {role:"system",content:prompt},
    {role:"user",content:message}
   ]
 });

 return JSON.parse(
   res.choices[0].message.content.replace(/```json|```/g,"")
 );
}

module.exports = classifyIntent;