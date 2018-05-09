cat repo-SHAs.txt | xargs -P8 -n1 -I% bash -c 'echo %; \
 sha=$(echo % | cut -d" " -f2); \
 name=$(echo % | cut -d" " -f1); \
 head=$(echo $name | cut -d"/" -f1); \
 mkdir -p Repos/$head; \
 git clone -q https://github.com/$name Repos/$name; \
 git -C Repos/$name reset --hard $sha;'