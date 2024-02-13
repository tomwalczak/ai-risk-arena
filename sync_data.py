from github import Github
import os
import base64


g = Github(os.environ['GH_ACCESS_TOKEN'])

# Replace 'your_username' and 'your_repository' with your GitHub username and repository name
repo = g.get_repo("tomwalczak/ai-safety-arena")

branch = repo.get_branch(repo.default_branch)

# # Get the most recent commit on the default branch
# commit = branch.commit

# # Get the list of files changed in the commit
# files_changed = commit.files

# # Print the list of changed files
# for file in files_changed:
#     print(file.filename)

# for file in files_changed:
#     print(file.filename)
#     content = repo.get_contents(file.filename, ref=commit.sha)
#     decoded_content = base64.b64decode(content.content).decode('utf-8')
#     print(decoded_content)

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

all_folders = get_folders(contents)

for folder in all_folders:
    print(folder)

commit = branch.commit

files_changed = commit.files

for file in files_changed:
    print(file)
