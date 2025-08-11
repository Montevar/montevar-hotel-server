const mongoose = require('mongoose');
require('dotenv').config();

const Room = require('./models/Room'); // adjust path if needed

const rooms = [
  // Standard (4)
  {
    name: 'Malaysia',
    category: 'Standard',
    price: 25000,
    images: ['/images/malaysia.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'Cyprus',
    category: 'Standard',
    price: 25000,
    images: ['/images/cyprus.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'Turkey',
    category: 'Standard',
    price: 25000,
    images: ['/images/turkey.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'Croatia',
    category: 'Standard',
    price: 25000,
    images: ['/images/croatia.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },

  // Executive (4)
  {
    name: 'China',
    category: 'Executive',
    price: 27000,
    images: ['/images/china.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'Mexico',
    category: 'Executive',
    price: 27000,
    images: ['/images/mexico.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'Indonesia',
    category: 'Executive',
    price: 27000,
    images: ['/images/indonesia.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'Dubai',
    category: 'Executive',
    price: 27000,
    images: ['/images/dubia.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },

  // Classic Executive (9)
  {
    name: 'London',
    category: 'Classic Executive',
    price: 30000,
    images: ['/images/london.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'Milan',
    category: 'Classic Executive',
    price: 30000,
    images: ['/images/milan.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'Arezzo',
    category: 'Classic Executive',
    price: 30000,
    images: ['/images/arezzo.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'Russia',
    category: 'Classic Executive',
    price: 30000,
    images: ['/images/russia.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'Spain',
    category: 'Classic Executive',
    price: 30000,
    images: ['/images/spain.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'France',
    category: 'Classic Executive',
    price: 30000,
    images: ['/images/france.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'Italy',
    category: 'Classic Executive',
    price: 30000,
    images: ['/images/italy.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'USA',
    category: 'Classic Executive',
    price: 30000,
    images: ['/images/usa.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'Japan',
    category: 'Classic Executive',
    price: 30000,
    images: ['/images/japan.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
{
    name: 'Qatar',
    category: 'Classic Executive',
    price: 30000,
    images: ['/images/qatar.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'Germany',
    category: 'Classic Executive',
    price: 30000,
    images: ['/images/germany.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },


  // Super Executive (3)
  {
    name: 'Paris',
    category: 'Super Executive',
    price: 40000,
    images: ['/images/paris.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'India',
    category: 'Super Executive',
    price: 40000,
    images: ['/images/india.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },
  {
    name: 'Morocco',
    category: 'Super Executive',
    price: 40000,
    images: ['/images/moroco.jpg'],
    amenities: ['Free WiFi', 'Mini Fridge','Room Service', 'TV', 'Bathroom Essentials']
  },

  // Royal Suite (1)
  {
    name: 'Canada',
    category: 'Royal Suite',
    price: 100000,
    images: ['/images/canada.jpg'],
    amenities: [
      'King Size Bed',
      'Sitting Room',
      'Room Service',
      'Smart TV',
      'Free WiFi',
      'VIP Lounge Access'
    ]
  }
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
   });

    console.log('Connected to MongoDB');

    await Room.deleteMany({});
    console.log('Existing rooms deleted');

    await Room.insertMany(rooms);
    console.log('Rooms seeded successfully');

    await mongoose.connection.close();
    console.log('Connection closed');
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seed();
