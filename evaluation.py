from __future__ import print_function # Use a function definition from future version (say 3.x from 2.7 interpreter)
import requests
import os
import sys

import math
import numpy as np
import scipy.sparse
import cntk as C
import pygments

import re
import string

regex = re.compile(r"^[^\d\W]\w*$", re.UNICODE)
keywords = ["async", "await", "break", "continue", "class", "extends", "constructor", "super", "extends", "const", "let", "var", "debugger", "delete", "do", "while", "export", "import", "for", "each", "in", "of", "function", "return", "get", "set", "if", "else", "instanceof", "typeof", "null", "undefined", "switch", "case", "default", "this", "true", "false", "try", "catch", "finally", "void", "yield", "any", "boolean", "null", "never", "number", "string", "symbol", "undefined", "void", "as", "is", "enum", "type", "interface", "abstract", "implements", "static", "readonly", "private", "protected", "public", "declare", "module", "namespace", "require", "from", "of", "package"]
exclude = ["O", "$any$", "$any[]$", "$any[][]$"]

source_file = "data/source_wl"
target_file = "data/target_wl"
model_file = "models/model-1.cntk"
gold_root = "data/outputs-gold/"
checkJS_root = "data/outputs-checkjs/"
# Although we do create type-aligned JS files, scoring these files is problematic because we do not have a good oracle, so typically this should be false
evaluate_JS = False

# load dictionaries
source_wl = [line.rstrip('\n') for line in open(source_file)]
target_wl = [line.rstrip('\n') for line in open(target_file)]
source_dict = {source_wl[i]:i for i in range(len(source_wl))}
target_dict = {target_wl[i]:i for i in range(len(target_wl))}

# number of words in vocab, slot labels, and intent labels
vocab_size = len(source_dict)
num_labels = len(target_dict)
epoch_size = 17.955*1000*1000
minibatch_size = 5000
emb_dim = 300
hidden_dim = 650
num_epochs = 10

# Create the containers for input feature (x) and the label (y)
x = C.sequence.input_variable(vocab_size, name="x")
y = C.sequence.input_variable(num_labels, name="y")
t = C.sequence.input_variable(hidden_dim, name="t")

def BiRecurrence(fwd, bwd):
	F = C.layers.Recurrence(fwd)
	G = C.layers.Recurrence(bwd, go_backwards=True)
	x = C.placeholder()
	apply_x = C.splice(F(x), G(x))
	return apply_x

def create_model():
	embed = C.layers.Embedding(emb_dim, name='embed')
	encoder = BiRecurrence(C.layers.GRU(hidden_dim//2), C.layers.GRU(hidden_dim//2))
	recoder = BiRecurrence(C.layers.GRU(hidden_dim//2), C.layers.GRU(hidden_dim//2))
	project = C.layers.Dense(num_labels, name='classify')
	do = C.layers.Dropout(0.5)
	
	def recode(x, t):
		inp = embed(x)
		inp = C.layers.LayerNormalization()(inp)
		
		enc = encoder(inp)
		rec = recoder(enc + t)
		proj = project(do(rec))
		
		dec = C.ops.softmax(proj)
		return enc, dec
	return recode

def criterion(model, labels):
	ce	 = -C.reduce_sum(labels*C.ops.log(model))
	errs = C.classification_error(model, labels)
	return ce, errs

def enhance_data(data, enc):
	guesses = enc.eval({x: data[x]})
	inputs = C.ops.argmax(x).eval({x: data[x]})
	tables = []
	for i in range(len(inputs)):
		ts = []
		table = {}
		counts = {}
		for j in range(len(inputs[i])):
			inp = int(inputs[i][j])
			if inp not in table:
				table[inp] = guesses[i][j]
				counts[inp] = 1
			else:
				table[inp] += guesses[i][j]
				counts[inp] += 1
		for inp in table:
			table[inp] /= counts[inp]
		for j in range(len(inputs[i])):
			inp = int(inputs[i][j])
			ts.append(table[inp])
		tables.append(np.array(np.float32(ts)))
	s = C.io.MinibatchSourceFromData(dict(t=(tables, C.layers.typing.Sequence[C.layers.typing.tensor])))
	mems = s.next_minibatch(minibatch_size)
	data[t] = mems[s.streams['t']]

def create_trainer():
	masked_dec = dec*C.ops.clip(C.ops.argmax(y), 0, 1)
	loss, label_error = criterion(masked_dec, y)
	loss *= C.ops.clip(C.ops.argmax(y), 0, 1)

	lr_schedule = C.learning_parameter_schedule_per_sample([1e-4]*2 + [5e-5]*2 + [1e-6], epoch_size=int(epoch_size))
	momentum_as_time_constant = C.momentum_as_time_constant_schedule(1000)
	learner = C.adam(parameters=dec.parameters,
						 lr=lr_schedule,
						 momentum=momentum_as_time_constant,
						 gradient_clipping_threshold_per_sample=15, 
						 gradient_clipping_with_truncation=True)

	progress_printer = C.logging.ProgressPrinter(tag='Training', num_epochs=num_epochs)
	trainer = C.Trainer(dec, (loss, label_error), learner, progress_printer)
	trainer.restore_from_checkpoint(model_file)
	C.logging.log_number_of_parameters(dec)
	return trainer

def run_seq(seq):
	inputs = np.zeros(len(seq))
	outputs = np.zeros(len(seq))
	for i in range(len(seq)):
		inputs[i] = source_dict[seq[i]] if seq[i] in source_dict else source_dict["_UNKNOWN_"]
	N = len(inputs)
	if N > minibatch_size:
		return None
	inputs = scipy.sparse.csr_matrix((np.ones(N, np.float32), (range(N), inputs)), shape=(N, vocab_size))
	outputs = scipy.sparse.csr_matrix((np.ones(N, np.float32), (range(N), outputs)), shape=(N, num_labels))
	sIn = C.io.MinibatchSourceFromData(dict(xx=([inputs], C.layers.typing.Sequence[C.layers.typing.tensor]),
											yy=([outputs], C.layers.typing.Sequence[C.layers.typing.tensor])))
	mb = sIn.next_minibatch(N)
	data = {x: mb[sIn.streams['xx']], y: mb[sIn.streams['yy']]}
	
	enhance_data(data, enc)
	pred = dec.eval({x: data[x], t: data[t]})[0]
	ranks = []
	for ix in range(len(pred)):
		pr = pred[ix]
		r = [(i, v) for (i, v) in sorted(enumerate(pr), key=lambda x: x[1], reverse=True)][:10]
		ranks.append(r)
	return ranks

model = create_model()
enc, dec = model(x, t)
num_steps = 0

with open('data/test_projects.txt', 'r') as f:
	test_projects = [line.rstrip() for line in f]

if not os.path.exists("results"):
	os.mkdir("results")

with open("results/evaluation-true.txt", "w") as f_out:
	for project in test_projects:
		print(project)
		trainer = create_trainer()
		checkJS_types = {}
		try:
			with open(checkJS_root + project, 'r') as f:
				for l in f:
					split = l.rstrip().split("\t")
					if len(split) < 2:
						continue
					tokens = split[0]
					types = split[1].split(" ")
					checkJS_types[tokens] = types
			with open(gold_root + project, 'r') as f:
				for l in f:
					split = l.rstrip().split("\t")
					if len(split) < 2:
						print("S", end='')
						continue
					tokens = split[0]
					types = split[1].split(" ")
					# Get types from CheckJS
					if tokens not in checkJS_types:
						print("N", end='')
						continue
					cj_types = checkJS_types[tokens]
					if len(types) != len(cj_types):
						print("D", end='')
						continue
					# Set up tokens for DL
					tokens = tokens.split(" ")
					if tokens[0] != "'js'":
						if evaluate_JS:
							continue
					elif not evaluate_JS:
						continue
					tokens.insert(0, "<s>")
					tokens.append("</s>")
					types.insert(0, "O")
					types.append("O")
					cj_types.insert(0, "O")
					cj_types.append("O")
					for i in range(len(types)):
						if types[i] not in target_dict:
							types[i] = "$any$"
						if cj_types[i] not in target_dict:
							cj_types[i] = "$any$"
					# Run deep learner
					try:
						predictions = run_seq(tokens)
						if predictions == None:
							raise ValueError
					except ValueError:
						print("E", end='')
						continue
					# Get stats
					for i in range(len(types)):
						if types[i] == "O":
							continue
						pred, conf = predictions[i][0]
						cj_type = cj_types[i]
						dl_type = target_wl[int(pred)]
						dl_rank = 0
						for ix, (pr, _) in enumerate(predictions[i]):
							if target_wl[int(pr)] == types[i]:
								dl_rank = ix + 1
								break
						f_out.write("%s\t%s\t%s\t%.4f\t%d\n" % (types[i], cj_type, dl_type, conf, dl_rank))
					f_out.flush()
		except Exception as e:
			continue
