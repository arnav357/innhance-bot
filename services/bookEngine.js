function mergeBooking(oldData, newData) {
  return {
    ...oldData,
    ...Object.fromEntries(
      Object.entries(newData).filter(([k, v]) => v !== null && v !== undefined),
    ),
  };
}

function getMissing(data, hotel) {
  if (!data.roomType) return "roomType";
  const room = hotel.rooms.find(
    (r) => r.name.toLowerCase() === data.roomType?.toLowerCase(),
  );

  if (room?.plans?.length > 1 && !data.planName) {
    return "planName";
  }
  if (!data.checkIn) return "checkIn";
  if (!data.checkOut) return "checkOut";
  if (!data.roomsCount) return "roomsCount";
  const totalGuests =
    data.guests || (data.adultsCount || 0) + (data.childrenCount || 0);

  if (!totalGuests) return "guests";
  
  if (!data.name) return "name";

  return null;
}

module.exports = { mergeBooking, getMissing };
