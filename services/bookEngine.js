function mergeBooking(oldData,newData){
 return {
   ...oldData,
   ...Object.fromEntries(
      Object.entries(newData).filter(([k,v])=>v!==null && v!==undefined)
   )
 };
}


function getMissing(data){

 if(!data.roomType) return "roomType";
 if(!data.checkIn) return "checkIn";
 if(!data.checkOut) return "checkOut";
 if(!data.roomsCount) return "roomsCount";
 if(!data.guests) return "guests";
 if(!data.name) return "name";

 return null;
}

module.exports = { mergeBooking, getMissing };