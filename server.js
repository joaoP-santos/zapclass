const fs = require("fs");
const readline = require("readline");
const { google, CloudPubsubTopic, Feed, Registration } = require("googleapis");

const SCOPES = [
  "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
  "https://www.googleapis.com/auth/classroom.announcements.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.push-notifications",
  "https://www.googleapis.com/auth/classroom.courses"
];

const TOKEN_PATH = "token.json";

const wa = require("@open-wa/wa-automate");
const admin = require("firebase-admin");
const serviceAccount = require("./firebase-service.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
wa.create({
  autoRefresh: true,
  cacheEnabled: false,
  sessionId: "jp",
  authTimeout: 70000
}).then(client => start(client));

async function start(client) {

  client.onMessage(async message => {
    if (
      !["557398417683@c.us", "557398653542@c.us", "557399622613@c.us"].includes(
        message.sender.id
      )
    )
      return;
    if (message.isGroupMsg && message.content.toLowerCase() == "configurar") {
      await client.sendText(message.from, "Iniciando configuração...");
      getCredentials(message, client);
    } else if (!message.isGroupMsg) {
      await client.sendText(
        message.from,
        "Olá! Me adicione em um grupo para me configurar e utilizar minhas funcionalidades."
      );
    }
  });
  client.onAddedToGroup(async chat => {
      await client.sendText(
        chat.id,
        'Obrigado por me adicionar no grupo! Envie "configurar" para iniciar a configuração.'
      );
    })
    .catch(error => {
      console.log(error);
    });
  await getGroups(client)
  setInterval(getGroups, 90000);
}
async function getGroups(client) {
    const groups = await client.getAllGroups()
    .catch(error => {console.log(error)})
    
    const dbGroups = (await db.collection(`groups`).get()).docs;
    groups.forEach(async group => {
      
      const dbGroup = await dbGroups.find(element => element.data().group == group.id)
      if(dbGroup == undefined) return;
      else {
        await getCourses(client, dbGroup.data())
      }
    })
  };
async function getCredentials(message, client, group) {
  fs.readFile("credentials.json", (err, content) => {
    if (err) return console.log("Error loading client secret file:", err);
    // Authorize a client with credentials, then call the Google Classroom API.
    const authorizeCredentials = authorize(JSON.parse(content), chooseCourse, message, client);
    console.log(authorizeCredentials)
    return authorizeCredentials
  });
}
async function authorize(credentials, callback, message, client) {
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );
    // Check if we have previously stored a token.
    let token = db.doc(`groups/${message.from}`).get();
    if (!token.exists) {
      return getNewToken(oAuth2Client, callback, message, client);
    } else {
      token = token.data().token;
      oAuth2Client.setCredentials(JSON.parse(token));
      console.log(oAuth2Client)
      return oAuth2Client


      //callback(oAuth2Client, message, client, token);
    }
  }
async function getCourses(client, dbGroup){
  const oAuth2Client = await getCredentials('message', client)
  console.log(oAuth2Client)
  const classroom = google.classroom({ version: "v1", oAuth2Client });
  const course = await classroom.courses.get({id: dbGroup.course})
  console.log(course)
  
  
}
async function getNewToken(oAuth2Client, callback, message, client) {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES
    });

    await client.sendText(
      message.from,
      `Autorize o bot a acessar sua turma por esse link: ${authUrl}`
    );
    await client.sendText(
      message.from,
      "Depois de autenticar, envie o código."
    );
    const filter = m => m.body.length > 1;
    let codeSent = "";

    const collector = client
      .createMessageCollector(message, () => true, { max: 1 })

      .on("collect", async message => {
        const code = message.body;

        console.log(code);

        oAuth2Client.getToken(code, (err, token) => {
          if (err) return console.error("Error retrieving access token", err);
          oAuth2Client.setCredentials(token);
          callback(oAuth2Client, message, client, token);
        });
      });
  }
async function chooseCourse(auth, message, client, token) {
  await client.sendText(message.from, "Autenticado com sucesso.");
  const classroom = google.classroom({ version: "v1", auth });
  classroom.courses.list(
    {
      pageSize: 10
    },
    (err, res) => {
      if (err) return console.error("The API returned an error: " + err);
      const courses = res.data.courses;
      if (courses && courses.length) {
        client.sendText(message.from, "Escolha um curso:");
        courses.forEach(course => {
          client.sendText(message.from, `${course.name}`);
        });
        const collector = client
          .createMessageCollector(message, () => true, { max: 1 })
          .on("collect", async message => {
            const course = courses.find(
              element => element.name == message.body
            );
            client.sendText(message.from, `Curso escolhido: ${course.name}`);
            const group = await db.doc(`groups/${message.from}`);
            await group.set({
              course: course.id,
              group: message.from,
              token: token
            });
            await client.sendText(
              message.from,
              `Configuração concluída com sucesso. A partir de agora, notificações para o curso ${course.name} serão enviadas aqui.`
            );
          });
      } else {
        client.sendText(
          message.from,
          `Nenhum curso encontrado para essa conta.`
        );
      }
    }
  );
}