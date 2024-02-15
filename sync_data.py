from github import Github
from supabase_py import create_client, Client
from openai import OpenAI
import os
import base64
import uuid


g = Github(os.environ['GH_ACCESS_TOKEN'])
openai = OpenAI(
  api_key=os.environ.get(os.environ["OPENAI_API_KEY"]),
 )

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")
supabase = create_client(url, key)

response = supabase.table('arguments').select("*").execute()

print(response)

repo = g.get_repo("tomwalczak/ai-safety-arena")

branch = repo.get_branch(repo.default_branch)

contents = repo.get_contents("", ref=branch.commit.sha)

def get_folders(contents):
    folders = []
    for content in contents:
        if (content.path == ".github"):
            continue
        if content.type == "dir":
            
            folders.append(content.path)
            # folders.extend(get_folders(repo.get_contents(content.path, ref=branch.commit.sha)))
    return folders

# all_folders = get_folders(contents)

def get_files_from_knowledge_base(folder):
    knowledge_base_folder_contents = repo.get_contents(f"{folder}/knowledge_base", ref=branch.commit.sha)
    return knowledge_base_folder_contents


def get_text_from_a_file(path):
    content = repo.get_contents(path, ref=branch.commit.sha)
    decoded_content = base64.b64decode(content.content).decode('utf-8')
    return decoded_content

def prepare_data_for_supabase_insertion():
    data = []
    all_folders = get_folders(contents)
    print(all_folders)
    for folder in all_folders:
        files = get_files_from_knowledge_base(folder)
        for file in files:
            arg_text = get_text_from_a_file(file.path)
            temp = {
                "id": uuid.uuid4(),
                "argument": arg_text,
                "argument_type": folder,
                "file_name": file.path.split("/knowledge_base/")[1],
                "embedded_argument": openai.embeddings.create(input=arg_text, model="text-embedding-ada-002").data[0].embedding
            }
            print(data)
            data.append(temp)
    return data

prepare_data_for_supabase_insertion()




# commit = branch.commit

# files_changed = commit.files

# for file in files_changed:
#     print(file.filename.split("/knowledge_base/"))
#     content = repo.get_contents(file.filename, ref=commit.sha)
#     decoded_content = base64.b64decode(content.content).decode('utf-8')
#     print(decoded_content)



