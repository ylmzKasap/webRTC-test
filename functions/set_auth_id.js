import generateRandomString from './generate_random_string';

export default function setAuthID() {
  let authID = localStorage.getItem('authID');
  if (!authID) {
    authID = generateRandomString(64);
    localStorage.setItem('privateID', authID);
  }
  return authID;
}