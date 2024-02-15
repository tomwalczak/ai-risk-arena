const { Octokit } = require("@octokit/rest");
const { createClient } = require("@supabase/supabase-js");
const { OpenAI } = require("openai");
const { v4 } = require("uuid");

require("dotenv").config();

const octokit = new Octokit({ auth: process.env.GH_ACCESS_TOKEN });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI(process.env.OPENAI_API_KEY);

async function fetchDataFromGitHub() {
  try {
    const repo = await octokit.repos.get({
      owner: "tomwalczak",
      repo: "ai-safety-arena",
    });

    // console.log(repo);

    const branch = await octokit.repos.getBranch({
      owner: repo.data.owner.login,
      repo: repo.data.name,
      branch: repo.data.default_branch,
    });

    // console.log(branch);

    const contents = await octokit.repos.getContent({
      owner: "tomwalczak",
      repo: "ai-safety-arena",
      ref: branch.data.name,
    });

    const folders = contents.data.filter((content) => content.type === "dir" && content.name !== ".github").map((folder) => folder.name);

    const folderDataPromises = folders.map(async (folder) => {
      return getDataFromFolder(repo.data.owner.login, repo.data.name, repo.data.default_branch, `${folder}/knowledge_base`);
    });

    const data = await Promise.all(folderDataPromises);
    console.log(data);
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

    // console.log(folderContents);

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
          };
        }
      })
    );
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

async function checkIfInitialSync() {
  const { data: arguments } = await supabase.from("arguments").select("*");
  if (arguments.length === 0) {
    return true;
  }
  return false;
}

// async function insertDataInSupabase(data) {
//   try {
//     await data.forEach(async (type) => {
//       type.forEach(async (arg) => {
//         const { error } = await supabase.from("arguments").insert({ id: arg.id, argument: arg.argument, argument_embedding: arg.argument_embedding, argument_type: arg.argument_type, file_name: arg.file_name });
//       });
//     });
//     console.log("Inserted");
//   } catch (error) {
//     console.error(error);
//   }
// }

async function insertDataInSupabase(data) {
  try {
    for (const type of data) {
      for (const arg of type) {
        const { error } = await supabase.from("arguments").insert({
          id: arg.id,
          argument: arg.argument,
          argument_embedding: arg.argument_embedding,
          type_of_argument: arg.type_of_argument,
          file_name: arg.file_name,
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

async function main() {
  const isInitialSync = await checkIfInitialSync();
  console.log(isInitialSync);
  if (isInitialSync) {
    let data = await fetchDataFromGitHub();
    await insertDataInSupabase(data);
  }
}

main();