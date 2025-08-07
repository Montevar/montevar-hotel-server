// seed/seedRooms.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('../config/db');
const Room = require('../models/Room');

dotenv.config();

const sampleImage = (roomName) =>
  [`https://source.unsplash.com/featured/?hotel,room,${encodeURIComponent(roomName)}`];

const getDescription = (name, category) =>
  `${name} is a beautifully designed ${category.toLowerCase()} room offering modern amenities, comfort, and privacy for a relaxing stay.`;

const defaultAmenities = [
  'Free Wi-Fi',
  'Air Conditioning',
  'Room Service',
  'Smart TV',
  'Mini Fridge',
];

const categoryDetails = {
  'Standard': { beds: 1, capacity: 2 },
  'Executive': { beds: 1, capacity: 2 },
  'Classic Executive': { beds: 1, capacity: 3 },
  'Super Executive': { beds: 1, capacity: 3 },
  'Royal Suite': { beds: 1, capacity: 5 },
};

const seedRooms = async () => {
  try {
    await connectDB();
    console.log('✅ Connected to MongoDB');

    await Room.deleteMany({});
    console.log('🗑️ Old rooms deleted');

    const rooms = [
      { name: 'Malaysia', category: 'Standard', price: 25000 },
      { name: 'Cyprus', category: 'Standard', price: 25000 },
      { name: 'Turkey', category: 'Standard', price: 25000 },
      { name: 'Croatia', category: 'Standard', price: 25000 },

      { name: 'China', category: 'Executive', price: 27000 },
      { name: 'Mexico', category: 'Executive', price: 27000 },
      { name: 'Indonesia', category: 'Executive', price: 27000 },
      { name: 'Dubai', category: 'Executive', price: 27000 },

      { name: 'London', category: 'Classic Executive', price: 30000 },
      { name: 'Milian', category: 'Classic Executive', price: 30000 },
      { name: 'Italy', category: 'Classic Executive', price: 30000 },
      { name: 'Russia', category: 'Classic Executive', price: 30000 },
      { name: 'Spain', category: 'Classic Executive', price: 30000 },
      { name: 'France', category: 'Classic Executive', price: 30000 },
      { name: 'Croatia', category: 'Classic Executive', price: 30000 },
      { name: 'USA', category: 'Classic Executive', price: 30000 },
      { name: 'Japan', category: 'Classic Executive', price: 30000 },

      { name: 'Paris', category: 'Super Executive', price: 40000 },
      { name: 'India', category: 'Super Executive', price: 40000 },
      { name: 'Morocco', category: 'Super Executive', price: 40000 },

      { name: 'Canada', category: 'Royal Suite', price: 100000 },
    ];

    const roomsWithDetails = rooms.map(room => {
      const { beds, capacity } = categoryDetails[room.category];
      return {
        ...room,
        description: getDescription(room.name, room.category),
        amenities: defaultAmenities,
        beds,
        capacity,
        images: sampleImage(room.name),
      };
    });

    await Room.insertMany(roomsWithDetails);
    console.log(`✅ Seeded ${roomsWithDetails.length} rooms with full details`);
    process.exit();
  } catch (err) {
    console.error('❌ Seeding error:', err);
    process.exit(1);
  }
};

seedRooms();
