JWT Authentication with RSA Keys
This project demonstrates how to implement JWT authentication using RSA key pairs. It includes generating keys, encoding them for secure storage, and signing/verifying JWTs.
Prerequisites

Node.js installed
OpenSSL installed

Setup
1. Install Dependencies
npm install dotenv jsonwebtoken fs path

2. Generate RSA Key Pair
Run the following commands in the terminal to generate the keys:
openssl genpkey -algorithm RSA -out private.pem
openssl rsa -in private.pem -pubout -out public.pem

3. Convert Keys to Base64
Run these commands in PowerShell to encode the keys:
[Convert]::ToBase64String([System.IO.File]::ReadAllBytes("D:\AIM\05_Backend\oauth\private.pem")) | Set-Clipboard
[Convert]::ToBase64String([System.IO.File]::ReadAllBytes("D:\AIM\05_Backend\oauth\public.pem")) | Set-Clipboard

4. Store Keys in .env
Create a .env file and add:
JWT_PRIVATE_KEY=your_base64_encoded_private_key
JWT_PUBLIC_KEY=your_base64_encoded_public_key
JWT_ALGORITHM=RS256
JWT_EXPIRATION=7d

5. Load Environment Variables
In your Node.js application, load environment variables:
import dotenv from 'dotenv';
dotenv.config();

6. Decode Base64 Keys
const privateKey = Buffer.from(process.env.JWT_PRIVATE_KEY, 'base64').toString('utf8');
const publicKey = Buffer.from(process.env.JWT_PUBLIC_KEY, 'base64').toString('utf8');

7. JWT Token Functions
Generate JWT
import jwt from 'jsonwebtoken';

export const generateToken = (userId) => {
    return jwt.sign({ userId }, privateKey, {
        algorithm: process.env.JWT_ALGORITHM || 'RS256',
        expiresIn: process.env.JWT_EXPIRATION || '7d',
    });
};

Verify JWT
export const verifyToken = (token) => {
    try {
        return jwt.verify(token, publicKey, { algorithms: [process.env.JWT_ALGORITHM || 'RS256'] });
    } catch (error) {
        return null;
    }
};

8. Example Usage
const token = generateToken('12345');
console.log('Generated Token:', token);
console.log('Verified Data:', verifyToken(token));

License
This project is licensed under the MIT License.
