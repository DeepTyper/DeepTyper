import json
import re
import os
import random
random.seed(42)

data_dir = "data/"
in_dir = data_dir + "outputs-all/"
min_source_vocab = 10
min_target_vocab = 10
minibatchMaxSize = 5000
# For debugging: set to the fraction of projects to include for shorter training (1 means keep all)
fraction = 1
include_JS = False

file_count = 0
for file in os.listdir(in_dir):
	if "DefinitelyTyped" in file:
		continue
	if os.stat(in_dir + "/" + file).st_size == 0:
		continue
	file_count += 1

tenth = file_count//10
indices = list(range(file_count))
random.shuffle(indices)
train_indices = indices[:(8*len(indices))//10]
valid_indices = indices[(8*len(indices))//10:(9*len(indices))//10]
test_indices = indices[(9*len(indices))//10:]

# Write test projects for later evaluation
file_count = 0
with open(data_dir + "test_projects.txt", "w") as f:
	for file in os.listdir(in_dir):
		if "DefinitelyTyped" in file:
			continue
		if os.stat(in_dir + "/" + file).st_size == 0:
			continue
		if file_count in test_indices:
			f.write(file)
			f.write("\n")
		file_count += 1

train_sources = []
train_targets = []
valid_sources = []
valid_targets = []
test_sources = []
test_targets = []

file_count = 0
for file in os.listdir(in_dir):
	if "DefinitelyTyped" in file:
		continue
	if os.stat(in_dir + "/" + file).st_size == 0:
		continue
	print("Processing %d: %s" % (file_count, file))
	with open(in_dir + "/" + file, "r", encoding="utf-8") as f:
		content = [line.strip() for line in f]
		for ix, line in enumerate(content):
			if len(line) == 0:
				continue
			parts = line.split("\t")
			if len(parts) < 2:
				continue
			source_tokens = ["<s>"] + parts[0].split(' ') + ["</s>"]
			target_tokens = ["O"] + parts[1].split(' ') + ["O"]
			if source_tokens[1] == "'js'" and not include_JS:
				continue
			if len(source_tokens) != len(target_tokens):
				print("Different lengths at line %d!" % ix)
				print("%d, %d" % (len(source_tokens), len(target_tokens)))
				break
			if len(source_tokens) > minibatchMaxSize:
				continue
			if file_count in train_indices:
				train_sources.append(source_tokens)
				train_targets.append(target_tokens)
			elif file_count in valid_indices:
				valid_sources.append(source_tokens)
				valid_targets.append(target_tokens)
			elif file_count in test_indices:
				test_sources.append(source_tokens)
				test_targets.append(target_tokens)
	file_count += 1

print("Train projects: %d" % len(train_indices))
print("Validation projects: %d" % len(valid_indices))
print("Test projects: %d" % len(test_indices))

print("Train files: %d" % len(train_sources))
print("Validation files: %d" % len(valid_sources))
print("Test files: %d" % len(test_sources))

### Vocabularies
print("Producing vocabularies")
source_counts = dict()
target_counts = dict()
for source in train_sources:
	for t in source:
		source_counts[t] = source_counts.get(t, 0) + 1
for target in train_targets:
	for t in target:
		target_counts[t] = target_counts.get(t, 0) + 1

source_words = sorted(source_counts.items(), key=lambda x : x[1], reverse=True)
source_cutoff = 0
for ix, (_, count) in enumerate(source_words):
	source_cutoff = ix
	if count < min_source_vocab:
		break
source_words = source_words[:source_cutoff]
source_word_vocab = set([word for word, _ in source_words])
if "<s>" not in source_word_vocab:
	source_words.append(("<s>", 0))
	source_word_vocab.add("<s>")
if "</s>" not in source_word_vocab:
	source_words.append(("</s>", 0))
	source_word_vocab.add("</s>")
source_words.append(("_UNKNOWN_", 0))
source_word_vocab.add("_UNKNOWN_")

target_words = sorted(target_counts.items(), key=lambda x : x[1], reverse=True)
target_cutoff = 0
for ix, (_, count) in enumerate(target_words):
	target_cutoff = ix
	if count < min_target_vocab:
		break
target_words = target_words[:target_cutoff]
target_word_vocab = set([word for word, _ in target_words])

with open(data_dir + "source_wl", "w", encoding="utf-8") as out:
	for name, count in source_words:
		out.write(name)
		out.write("\n")

with open(data_dir + "target_wl", "w", encoding="utf-8") as out:
	for name, count in target_words:
		out.write(name)
		out.write("\n")

print("Size of source vocab: %d" % len(source_words))
print("Size of target vocab: %d" % len(target_words))

### Output files
print("Writing train/valid/test files")
def write(file, sources, targets):
	with open(file, "w", encoding="utf-8") as f:
		token_count = 0
		for i in range(len(sources)):
			source = sources[i]
			target = targets[i]
			source_tokens = [token if token in source_word_vocab else '_UNKNOWN_' for token in source]
			target_tokens = [token if token in target_word_vocab else '$any$' for token in target]
			if random.random() > fraction:
				continue
			if len(source_tokens) != len(target_tokens):
				print("Different lengths at line %d!" % ix)
				print("%d, %d" % (len(source_tokens), len(target_tokens)))
			token_count += len(source_tokens)
			f.write(" ".join(source_tokens))
			f.write("\t")
			f.write(" ".join(target_tokens))
			f.write("\n")
	return token_count

train_file = data_dir + "train.txt"
valid_file = data_dir + "valid.txt"
test_file = data_dir + "test.txt"
train_tokens = write(train_file, train_sources, train_targets)
valid_tokens = write(valid_file, valid_sources, valid_targets)
test_tokens = write(test_file, test_sources, test_targets)

print("Overall tokens: %d train, %d valid and %d test" % (train_tokens, valid_tokens, test_tokens))
