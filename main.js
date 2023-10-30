import './style.css'
import { initializeApp } from "firebase/app";
import { getFirestore, collection, onSnapshot, doc, addDoc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID
};

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
let localConnection = new RTCPeerConnection(servers);
let sendChannel;
let receiveChannel;

const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);

// HTML elements
const roomID = document.getElementById('room-id');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const sendButton = document.getElementById('sendButton');
const messageInput = document.getElementById('message-input')



// 2. Create an offer
callButton.onclick = async () => {
  sendChannel = localConnection.createDataChannel('sendDataChannel');
  console.log('Created send data channel');
  sendChannel.onopen = () => console.log('Opened send channel');
  
  localConnection.ondatachannel = receiveChannelCallback;

  // Reference Firestore collections for signaling
  const callsCollection = collection(firestore, 'calls');
  const callDoc = doc(callsCollection);

  roomID.innerText = `Room ID: ${callDoc.id}`;

  const offerCandidates = collection(callDoc, 'offerCandidates');
  const answerCandidates = collection(callDoc, 'answerCandidates');

  // Get candidates for caller, save to db
  localConnection.onicecandidate = (event) => {
    if (event.candidate)  {
      console.log(`Candidate for caller ${event.candidate}`);
      addDoc(offerCandidates, event.candidate.toJSON());
    };
  };

  // Create offer
  const offerDescription = await localConnection.createOffer();
  await localConnection.setLocalDescription(offerDescription);
  console.log(`Offer from local connection: ${offerDescription.sdp}`);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await setDoc(callDoc, offer);

  // Listen for remote answer
  onSnapshot(callDoc, (snapshot) => {
    const data = snapshot.data();
    if (!localConnection.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      localConnection.setRemoteDescription(answerDescription);
      console.log(`Answer from remote connection ${answerDescription.sdp}`);
    }
  });

  // When answered, add candidate to peer connection
  onSnapshot(answerCandidates, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        localConnection.addIceCandidate(candidate);
        console.log(`Added ice candidate as local: ${candidate}`);
      }
    });
  });

  callButton.disabled = true;
  answerButton.disabled = true;
  sendButton.disabled = false;
};



// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;
  const callsCollection = collection(firestore, 'calls');
  const callDoc = doc(callsCollection, callId);

  sendChannel = localConnection.createDataChannel('sendDataChannel');
  localConnection.ondatachannel = receiveChannelCallback;

  const answerCandidates = collection(callDoc, 'answerCandidates');
  const offerCandidates = collection(callDoc, 'offerCandidates');

  localConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`Candidate for callee ${event.candidate}`);
      addDoc(answerCandidates, event.candidate.toJSON());
    }
  };

  const callData = (await getDoc(callDoc)).data();

  const offerDescription = callData;
  console.log('offer', offerDescription);
  await localConnection.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await localConnection.createAnswer();
  console.log('answer', offerDescription);
  await localConnection.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await updateDoc(callDoc, { answer });

  onSnapshot(offerCandidates, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        let data = change.doc.data();
        let candidate = new RTCIceCandidate(data);
        localConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log(`Candidate for callee (change) ${candidate}`);
      }
    });
  });

  sendButton.disabled = false;
  callButton.disabled = true;
};

sendButton.onclick = async () => {
  sendChannel.send(messageInput.value)  
}

function receiveChannelCallback(event) {
  console.log('Receive Channel Callback');
  receiveChannel = event.channel;
  receiveChannel.onmessage = (e) => messageInput.value = e.data;
  receiveChannel.onopen = () => console.log('-- Opened remote connection');
  receiveChannel.onclose = () => console.log('-- Closed remote connection');
}

