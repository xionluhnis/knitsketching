BLD_DIR=build
SRC_DIR=../nlopt
CMAKE_FLAGS=-DNLOPT_MATLAB=OFF -DNLOPT_FORTRAN=OFF -DNLOPT_GUILE=OFF -DNLOPT_OCTAVE=OFF -DNLOPT_SWIG=OFF -DNLOPT_TESTS=OFF -DNLOPT_PYTHON=OFF -DBUILD_SHARED_LIBS=OFF -DWITH_THREADLOCAL=OFF -DCMAKE_BUILD_TYPE=RelWithDebInfo
# -DCMAKE_CXX_FLAGS=-g

CPP_BIN=em++
ENV_FLAGS=ONLY_FORCED_STDLIBS=1
PRE_JS=
# JS_SETTINGS=-s "EXTRA_EXPORTED_RUNTIME_METHODS=['ccal', 'cwrap']" -s ERROR_ON_UNDEFINED_SYMBOLS=0
JS_SETTINGS=-s ERROR_ON_UNDEFINED_SYMBOLS=1 -s ASSERTIONS=1 -s DISABLE_EXCEPTION_CATCHING=0 -s ALLOW_MEMORY_GROWTH=1
CPP_FLAGS=-Wall -Wno-unused-label -std=c++17 -O0 -isystem$(BLD_DIR) -isystem$(SRC_DIR) -isystem$(SRC_DIR)/src/api/ -isystem$(SRC_DIR)/src

BASE_FLAGS=$(CPP_FLAGS) $(JS_SETTINGS) -L./build -llibnlopt
GLOBAL_FLAGS=$(BASE_FLAGS) --post-js global_sampling.post.js
LOCAL_FLAGS=$(BASE_FLAGS) --post-js local_sampling.post.js
SR_FLAGS=$(BASE_FLAGS) --bind --post-js sr_sampling.post.js
GLOBAL_SRC=global_sampling.cpp
GLOBAL_OUT=global_sampling.js
LOCAL_SRC=local_sampling.cpp
LOCAL_OUT=local_sampling.js
SR_SRC=sr_sampling.cpp
SR_OUT=sr_sampling.js

all: global local sr

configure:
	(cd $(BLD_DIR) && emcmake cmake ../$(SRC_DIR) $(CMAKE_FLAGS))

build/libnlopt.a: configure
	(cd $(BLD_DIR) && emmake make)

global/direct: build/libnlopt.a
	$(ENV_FLAGS) $(CPP_BIN) $(GLOBAL_SRC) -o $(GLOBAL_OUT) $(GLOBAL_FLAGS)

global/module: build/libnlopt.a
	$(ENV_FLAGS) $(CPP_BIN) $(GLOBAL_SRC) -o $(GLOBAL_OUT) $(GLOBAL_FLAGS) -s MODULARIZE=1

global: global/module

local/direct: build/libnlopt.a
	$(ENV_FLAGS) $(CPP_BIN) $(LOCAL_SRC) -o $(LOCAL_OUT) $(LOCAL_FLAGS)

local/module: build/libnlopt.a
	$(ENV_FLAGS) $(CPP_BIN) $(LOCAL_SRC) -o $(LOCAL_OUT) $(LOCAL_FLAGS) -s MODULARIZE=1

local: local/module

sr/direct: build/libnlopt.a
	$(ENV_FLAGS) $(CPP_BIN) $(SR_SRC) -o $(SR_OUT) $(SR_FLAGS)

sr/module: build/libnlopt.a
	$(ENV_FLAGS) $(CPP_BIN) $(SR_SRC) -o $(SR_OUT) $(SR_FLAGS) -s MODULARIZE=1

sr: sr/module

clean:
	rm -rf $(BLD_DIR)/*

cleanlib:
	rm build/libnlopt.a
