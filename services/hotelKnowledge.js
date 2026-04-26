async function answerHotelQuestion(question, hotel){

 const q = question.toLowerCase();

 if(q.includes("parking"))
   return hotel.parking ? "Yes 😊 Parking is available." :
   "Sorry, I can't confirm parking right now.";

 if(q.includes("breakfast"))
   return "Breakfast availability depends on selected room 😊";

 if(q.includes("check in"))
   return "Check-in is after 2 PM 😊";

 if(q.includes("check out"))
   return "Check-out is before 11 AM 😊";

 return null;
}

module.exports = answerHotelQuestion;