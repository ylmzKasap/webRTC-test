export default function generateRandomString(length) {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const crypto = window.crypto;

  if (!crypto || !crypto.getRandomValues) {
    throw new Error("Crypto API not available.");
  }

  const randomArray = new Uint8Array(length);
  crypto.getRandomValues(randomArray);

  let randomString = "";

  for (let i = 0; i < length; i++) {
    const randomIndex = randomArray[i] % charset.length;
    randomString += charset[randomIndex];
  }

  return randomString;
}