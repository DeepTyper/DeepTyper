import re
import numpy as np

regex = re.compile(r"^[^\d\W]\w*$", re.UNICODE)
keywords = ["async", "await", "break", "continue", "class", "extends", "constructor", "super", "extends", "const", "let", "var", "debugger", "delete", "do", "while", "export", "import", "for", "each", "in", "of", "function", "return", "get", "set", "if", "else", "instanceof", "typeof", "null", "undefined", "switch", "case", "default", "this", "true", "false", "try", "catch", "finally", "void", "yield", "any", "boolean", "null", "never", "number", "string", "symbol", "undefined", "void", "as", "is", "enum", "type", "interface", "abstract", "implements", "static", "readonly", "private", "protected", "public", "declare", "module", "namespace", "require", "from", "of", "package"]

with open("data/train.ctf", "r") as f1, open("data/test.ctf", "r") as f2:
	mappings = {}
	for line in f1:
		parts = line.rstrip().split("\t")
		key = int(parts[1][4:len(parts[1])-2])
		value = int(parts[2][4:len(parts[2])-2])
		if value == 0:
			continue
		if key not in mappings:
			mappings[key] = {}
		if value not in mappings[key]:
			mappings[key][value] = 1
		else:
			mappings[key][value] += 1
	rankings = {}
	for key in mappings:
		counts = mappings[key].items()
		counts = sorted(counts, key=lambda x: x[1], reverse=True)
		rankings[key] = [c[0] for c in counts]
	# Now test
	accuracies = [0 for _ in range(10)]
	count = 0
	misses = 0
	for line in f2:
		parts = line.rstrip().split("\t")
		key = int(parts[1][4:len(parts[1])-2])
		value = int(parts[2][4:len(parts[2])-2])
		if value == 0 or value == 1:
			continue
		rank = 0
		if key not in rankings:
			continue
		elif value not in rankings[key]:
			rank = 10
		else:
			rank = rankings[key].index(value)
		if rank < 10:
			accuracies[rank] += 1
		else:
			misses += 1
		count += 1
	for i in range(len(accuracies)):
		accuracies[i] /= count
		if i > 0:
			accuracies[i] += accuracies[i - 1]
		print("%d: %.4f" % (i+1, accuracies[i]))
