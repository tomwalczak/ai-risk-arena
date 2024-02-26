const { Octokit } = require("@octokit/rest");
const { createClient } = require("@supabase/supabase-js");
const { OpenAI } = require("openai");
const { v4 } = require("uuid");

require("dotenv").config();

const octokit = new Octokit({ auth: process.env.GH_ACCESS_TOKEN });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI();
const owner = "tomwalczak";
const editor = "DinoDelicdev";

async function getRepo() {
  const repo = await octokit.repos.get({
    owner: owner,
    repo: "ai-safety-arena",
  });

  const branch = await octokit.repos.getBranch({
    owner: repo.data.owner.login,
    repo: repo.data.name,
    branch: repo.data.default_branch,
  });

  const contents = await octokit.repos.getContent({
    owner: owner,
    repo: "ai-safety-arena",
    ref: branch.data.name,
  });
  return { repo, branch, contents };
}

async function prepareDataForSupabaseInjection(folders) {
  const { repo, branch, contents } = await getRepo();
  const folderDataPromises = folders.map(async (folder) => {
    return getDataFromFolder(repo.data.owner.login, repo.data.name, repo.data.default_branch, `${folder}/knowledge_base`);
  });

  const data = await Promise.all(folderDataPromises);
  return data;
}

async function fetchDataFromGitHub() {
  try {
    const { repo, branch, contents } = await getRepo();

    const folders = contents.data.filter((content) => content.type === "dir" && content.name !== ".github").map((folder) => folder.name);

    const folderDataPromises = folders.map(async (folder) => {
      return getDataFromFolder(repo.data.owner.login, repo.data.name, repo.data.default_branch, `${folder}/knowledge_base`);
    });

    const data = await Promise.all(folderDataPromises);
    // console.log(data);
    return data;
    //console.log(texts);
  } catch (error) {
    console.error("Error fetching data from GitHub:", error);
  }
}

async function getDataFromFolder(owner, repo, branch, folderPath) {
  try {
    const { data: folderContents } = await octokit.repos.getContent({
      owner,
      repo,
      path: folderPath,
      ref: branch,
    });

    const metadata = await octokit.repos.getContent({
      owner,
      repo,
      path: folderPath.split("/knowledge_base")[0] + "/metadata.yaml",
      ref: branch,
    });

    let metadataText = Buffer.from(metadata.data.content, "base64").toString("utf-8");
    let sourceUrl = "";

    if (metadataText.indexOf("based_on") !== -1) {
      sourceUrl = metadataText.split("based_on:")[1].split("\n")[1].split("  - ")[1].trim();
    }

    // console.log(sourceUrl);

    const filesData = await Promise.all(
      folderContents.map(async (content) => {
        if (content.type === "file") {
          const fileContent = await octokit.repos.getContent({
            owner,
            repo,
            path: content.path,
            ref: branch,
          });

          let argText = Buffer.from(fileContent.data.content, "base64").toString("utf-8");
          let embedding = await createEmbeddings(argText);

          return {
            id: v4(),
            file_name: content.name,
            argument: argText,
            type_of_argument: folderPath.split("/knowledge_base")[0],
            argument_embedding: embedding,
            source: sourceUrl,
          };
        }
      })
    );

    // console.log(filesData);
    return filesData;
  } catch (error) {
    console.error("Error fetching folder data:", error);
    return [];
  }
}

async function createEmbeddings(argument) {
  const embedding = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: argument,
    encoding_format: "float",
  });

  return embedding.data[0].embedding;
}

async function getArgumentTypesFromSupabase() {
  const { data } = await supabase.from("arguments").select("type_of_argument");
  let types = data.reduce((acc, type) => {
    if (!acc.includes(type.type_of_argument)) {
      return [...acc, type.type_of_argument];
    } else {
      return acc;
    }
  }, []);
  return types;
}

async function checkIfInitialSync() {
  let data = await getArgumentTypesFromSupabase();
  if (data.length === 0) {
    return true;
  }
  return false;
}

async function insertDataInSupabase(data) {
  // console.log(data);
  try {
    for (const type of data) {
      for (const arg of type) {
        const { error } = await supabase.from("arguments").insert({
          id: arg.id,
          argument: arg.argument,
          argument_embedding: arg.argument_embedding,
          type_of_argument: arg.type_of_argument,
          file_name: arg.file_name,
          source: arg.source,
        });
        if (error) {
          throw new Error(`Error inserting data: ${error.message}`);
        }
      }
    }
    console.log("Inserted");
  } catch (error) {
    console.error(error);
  }
}

async function getLatestCommit() {
  const { repo } = await getRepo();

  const { data: latestCommit } = await octokit.repos.getCommit({
    owner: repo.data.owner.login,
    repo: repo.data.name,
    ref: repo.data.default_branch,
  });

  // console.log(latestCommit.committer.login);
  // console.log;
  if (latestCommit.committer.login !== owner && latestCommit.committer.login !== editor) {
    return [];
  }
  return latestCommit.files.filter((file) => file.filename !== "sync_data.js");
}

async function getFoldersFromRepo() {
  const { contents } = await getRepo();
  const foldersInRepo = contents.data.filter((content) => content.type === "dir" && content.name !== ".github").map((folder) => folder.name);
  return foldersInRepo;
}

async function getNewlyAddedFolders() {
  let existingFolders = await getArgumentTypesFromSupabase();
  const foldersInRepo = await getFoldersFromRepo();

  let addedFolders = foldersInRepo.filter((folder) => !existingFolders.includes(folder));

  return addedFolders;
}

function getSingleFilesReadyForUpdates(addedFolders, commit) {
  let files = commit.filter((file) => {
    return !addedFolders.includes(file.filename.split("/knowledge_base")[0]);
  });
  let filesSorted = {
    updated: files.filter((file) => {
      return file.filename.includes("knowledge_base") && file.status === "modified";
    }),
    deleted: files.filter((file) => {
      return file.filename.includes("knowledge_base") && file.status === "removed";
    }),
    added: files.filter((file) => {
      return file.filename.includes("knowledge_base") && file.status === "added";
    }),
  };
  // console.log(filesSorted);
  return filesSorted;
}

async function updateArgumentsInSupabase(obj) {
  obj.updated.forEach(async (arg) => {
    let { repo } = await getRepo();
    const fileContent = await octokit.repos.getContent({
      owner: repo.data.owner.login,
      repo: repo.data.name,
      path: arg.filename,
      ref: repo.data.default_branch,
    });

    let [argType, fileName] = arg.filename.split("/knowledge_base/");

    let argText = Buffer.from(fileContent.data.content, "base64").toString("utf-8");

    const { error } = await supabase.from("arguments").update({ argument: argText }).eq("type_of_argument", argType).eq("file_name", fileName);
  });
  obj.added.forEach(async (arg) => {
    let { repo } = await getRepo();
    const fileContent = await octokit.repos.getContent({
      owner: repo.data.owner.login,
      repo: repo.data.name,
      path: arg.filename,
      ref: repo.data.default_branch,
    });

    let [argType, fileName] = arg.filename.split("/knowledge_base/");

    let argText = Buffer.from(fileContent.data.content, "base64").toString("utf-8");
    let embedding = await createEmbeddings(argText);

    const { error } = await supabase.from("arguments").insert({ id: v4(), argument: argText, argument_embedding: embedding, type_of_argument: argType, file_name: fileName });
  });

  obj.deleted.forEach(async (arg) => {
    let [argType, fileName] = arg.filename.split("/knowledge_base/");
    const { error } = await supabase.from("arguments").delete().eq("type_of_argument", argType).eq("file_name", fileName);
  });
}

async function formatChatbots(folders) {
  let { repo } = await getRepo();
  let chatbots = [];
  for (let i = 0; i < folders.length; i++) {
    // console.log(folders[i]);
    let chatbot = { id: v4(), arguments: [folders[i]], wins: 0, losses: 0, draws: 0 };
    try {
      const prompt = await octokit.repos.getContent({
        owner: repo.data.owner.login,
        repo: repo.data.name,
        path: folders[i] + "/prompts/system_prompt.md",
        ref: repo.data.default_branch,
      });
      const metadata = await octokit.repos.getContent({
        owner: repo.data.owner.login,
        repo: repo.data.name,
        path: folders[i] + "/metadata.yaml",
        ref: repo.data.default_branch,
      });
      if (prompt.data.content) {
        chatbot.system_prompt = Buffer.from(prompt.data.content, "base64").toString("utf-8");
      }

      if (metadata.data.content) {
        let metadataText = Buffer.from(metadata.data.content, "base64").toString("utf-8");
        chatbot.name = metadataText.split("name: ")[1].split("\n")[0];
        chatbot.perspective = metadataText.split("sentiment: ")[1].split("\n")[0];
        chatbots.push(chatbot);
      }
    } catch (error) {
      console.error(error);
    }
  }
  // console.log(chatbots);
  return chatbots;
}

async function insertChatbotInSupabase(obj) {
  const { error } = await supabase.from("chatbots").insert({
    id: obj.id,
    name: obj.name,
    types: obj.arguments,
    wins: obj.wins,
    losses: obj.losses,
    draws: obj.draws,
    perspective: obj.perspective,
    system_prompt: obj.system_prompt,
    source: obj.source,
  });
}

async function prepareChatbotsForInsertionAndInsertInSupabase(folders) {
  // console.log(folders);
  let chatbotsReadyForInsertion = await formatChatbots(folders);
  chatbotsReadyForInsertion.forEach(async (chatbot) => {
    await insertChatbotInSupabase(chatbot);
  });
}

async function syncChatbots() {
  let chatbotsFromSupabase = await supabase.from("chatbots").select("*");
  let argumentTypes = await getArgumentTypesFromSupabase();
  let chatbotsFromSupabaseMapped = chatbotsFromSupabase.data.map((chatbot) => chatbot.types[0]);
  console.log(argumentTypes);
  console.log(chatbotsFromSupabaseMapped);
  for (let i = 0; i < chatbotsFromSupabaseMapped.length; i++) {
    if (!argumentTypes.includes(chatbotsFromSupabaseMapped[i])) {
      await supabase.from("chatbots").delete().eq("id", chatbotsFromSupabase.data[i].id);
    }
  }
}

async function main() {
  const isInitialSync = await checkIfInitialSync();
  const newlyAddedFolders = await getNewlyAddedFolders();
  const latestCommit = await getLatestCommit();
  let filesForUpdate = getSingleFilesReadyForUpdates(newlyAddedFolders, latestCommit);
  if (isInitialSync) {
    console.log("Jesteda");
    let data = await fetchDataFromGitHub();
    await insertDataInSupabase(data);
    let folders = await getFoldersFromRepo();
    await prepareChatbotsForInsertionAndInsertInSupabase(folders);
  } else if (newlyAddedFolders.length) {
    console.log("Njet");
    let data = await prepareDataForSupabaseInjection(newlyAddedFolders);
    await insertDataInSupabase(data);
    await prepareChatbotsForInsertionAndInsertInSupabase(newlyAddedFolders);
    await updateArgumentsInSupabase(filesForUpdate);
  } else {
    await updateArgumentsInSupabase(filesForUpdate);
  }

  await syncChatbots();
}

main();
